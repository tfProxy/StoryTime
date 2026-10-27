import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const sfx = Math.random().toString(36).slice(2, 8);
const made = [];
const mk = async (name, extra = {}) => {
  const t = await send("POST", "/api/tags", { name: `${name}${sfx}`, applies: "when it happens", not_applies: "never", ...extra });
  made.push(t.id);
  return t;
};
const before = (await send("GET", "/api/settings")).settings;
const setNotes = (on) => send("PUT", "/api/settings", { ...(before ?? {}), contentNotes: on });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

try {
  const shown = await mk("violence", { show_readers: true, choices: ["graphic"] });
  const deep = await mk("tg", { show_readers: true, kind: "state" });
  const hidden = await mk("private");

  const s = await send("POST", "/api/stories", { title: "Notes trial", chapter: { title: "Start", body: "Begin.", choices: ["Onward", "Unwritten way"] } });
  const [c1] = (await send("GET", `/api/chapters/${s.chapter_id}`)).choices;
  const child = (await send("POST", "/api/chapters", { choice_id: c1.id, title: "Middle", body: "Middle.", choices: ["Further"] })).chapter_id;
  const c2 = (await send("GET", `/api/chapters/${child}`)).choices[0];
  const grand = (await send("POST", "/api/chapters", { choice_id: c2.id, title: "Far", body: "Far." })).chapter_id;
  await send("POST", `/api/chapters/${child}/tags`, { tag_id: shown.id, value: "graphic" });
  await send("POST", `/api/chapters/${child}/tags`, { tag_id: hidden.id });
  await send("POST", `/api/chapters/${grand}/tags`, { tag_id: deep.id });

  await setNotes(true);
  await page.goto(`${BASE}/c/${s.chapter_id}`);
  const written = page.locator("a.choice-written", { hasText: "Onward" });
  await written.waitFor();
  const note = written.locator(".choice-note");
  ok((await note.innerText()) === `Next: violence${sfx} (graphic) · Later on this branch: tg${sfx}`, "the written choice shows Next and Later on this branch: " + (await note.innerText()));
  ok(!(await written.innerText()).includes(`private${sfx}`), "a tag not marked Show to readers is not listed");
  ok((await page.locator("a.choice-unwritten .choice-note").count()) === 0, "an unwritten choice has no note");

  await page.goto(`${BASE}/c/${child}`);
  ok((await page.locator("a.choice-written .choice-note").innerText()) === `Next: tg${sfx}`, "a tag only on the next chapter shows as Next, with no Later part");

  await page.goto(`${BASE}/c/${grand}`);
  ok((await page.locator(".choice-note").count()) === 0, "a chapter with no choices has no notes");

  // The Settings > Tags switch is on by default and turns the notes off.
  await page.goto(`${BASE}/settings#tags`);
  const box = page.getByRole("region", { name: "Tags" }).getByRole("checkbox", { name: /Show content notes to readers/ });
  await box.waitFor();
  ok(await box.isChecked(), "Show content notes to readers is on");
  await box.uncheck();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings?.contentNotes === false);
  await page.goto(`${BASE}/c/${s.chapter_id}`);
  await page.locator("a.choice-written", { hasText: "Onward" }).waitFor();
  ok((await page.locator(".choice-note").count()) === 0, "with the switch off no notes show");
  const html = await (await fetch(`${BASE}/api/stories/${s.story_id}/export?format=html`)).text();
  const pages = JSON.parse(/<script id="story-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]).pages;
  ok(pages[s.chapter_id].c[0].length === 2 && pages[child].c[0].length === 2, "…and the offline html export has none either");
} catch (e) {
  console.log("FAIL", e.message);
  failed = true;
} finally {
  await setNotes(before?.contentNotes ?? true);
  for (const id of made) await send("DELETE", `/api/tags/${id}`);
  await browser.close();
}
process.exit(failed ? 1 : 0);
