import { launch, useMockAi } from "./browser.mjs";

// "Flesh out" on a codex entry's own page ("+ Flesh out with AI…" beside "+ Add a fact"): the form (stay close, focus),
// the run it makes, where it is not offered; and its ideas under "AI ideas", kept from where the entry first appears or
// from their chapter, edited, or discarded. The queue is paused, so no AI is called (the AI side is covered by
// tests/api/flesh-out.test.mjs).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);
const clearQueue = async () => {
  for (const item of (await send("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
};

const ai = await useMockAi(BASE);
const browser = await launch();
try {
  // Root -> A (-> A2 for the writing page)
  const story = await post("/api/stories", { title: "Flesh Tale", premise: "p", chapter: { title: "Root", body: "Wren stood there.", choices: ["Go on"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const A = (await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${R}`)).choices[0].id, title: "Chapter A", body: "Wren walked.", choices: ["Onward"] })).chapter_id;
  const wren = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Wren", type: "character", content: "" })).entry_id;
  const hollow = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "The Hollow", type: "place", content: "" })).entry_id;
  const entryUrl = (id, at = R) => `${BASE}/s/${sid}/codex/${id}?at=${at}`;
  const descAt = async (chapter) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === "Wren").description;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await send("PUT", "/api/queue/paused", { paused: true });
  const facts = page.locator(".entry-facts");
  const fleshButton = facts.getByRole("button", { name: "+ Flesh out with AI…" });
  const form = facts.locator(".flesh-out");

  // not on the list of entries
  await page.goto(`${BASE}/c/${R}/codex`);
  await page.locator(".entry-card", { hasText: "Wren" }).waitFor();
  ok((await page.getByRole("button", { name: /Flesh out/ }).count()) === 0, "the list of entries has no Flesh out button");

  // on the entry's page: beside "+ Add a fact"; invent by default
  await page.goto(entryUrl(wren));
  await fleshButton.waitFor();
  const add = await facts.getByRole("button", { name: "+ Add a fact" }).boundingBox();
  const fb = await fleshButton.boundingBox();
  ok(Math.abs(add.y - fb.y) < 6 && fb.x > add.x, "+ Flesh out with AI… sits beside + Add a fact");
  await fleshButton.click();
  const stay = form.getByLabel(/Stay close to the story/);
  ok(!(await stay.isChecked()), "it opens the form at once; the default is to add new details");
  await form.getByLabel(/Focus/).fill("her family");
  const queued = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await form.getByRole("button", { name: "Suggest facts" }).click();
  const made = await (await queued).json();
  const run = await send("GET", `/api/ai-runs/${made.run_id}`);
  ok(made.tasks === 1 && run.tasks[0].kind === "expand" && run.tasks[0].entryId === wren && run.tasks[0].mode === "invent" && run.tasks[0].hint === "her family" && run.tasks[0].chapterId === R, "the button makes an 'invent' run for this entry at this chapter, with the focus");
  ok((await form.getByRole("button", { name: "Suggest facts" }).count()) === 0, "…and the form gives way to the run's progress");
  await clearQueue();

  // stay close, on another entry
  await page.goto(entryUrl(hollow));
  await fleshButton.click();
  await form.getByLabel(/Stay close to the story/).check();
  const queued2 = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/flesh-out`) && r.request().method() === "POST");
  await form.getByRole("button", { name: "Suggest facts" }).click();
  const run2 = await send("GET", `/api/ai-runs/${(await (await queued2).json()).run_id}`);
  ok(run2.tasks[0].mode === "close" && run2.tasks[0].entryId === hollow, "'Stay close' makes a 'close' run for that entry");
  await clearQueue();

  // cancel
  await page.goto(entryUrl(wren));
  await fleshButton.click();
  await form.getByRole("button", { name: "Cancel" }).click();
  ok((await fleshButton.isVisible()) && (await form.count()) === 0, "Cancel closes the form");

  // ---- what the AI made up: under "AI ideas", apart from the facts ----
  const rev = (await send("GET", `/api/chapters/${A}`)).chapter.revision;
  await post(`/api/chapters/${A}/codex-suggestions`, {
    revision: rev,
    source: "expand",
    entry_id: wren,
    suggestions: [
      { kind: "set", entry_id: wren, aspect: "Voice", form: "", after: "low and dry", quote: "" },
      { kind: "set", entry_id: wren, aspect: "Family", form: "", after: "an older brother", quote: "" },
      { kind: "set", entry_id: wren, aspect: "Fear", form: "", after: "deep water", quote: "" },
    ],
  });
  await page.goto(entryUrl(wren, A));
  const ideas = page.locator("section.entry-ideas");
  await ideas.waitFor();
  ok((await ideas.getByRole("heading", { name: "AI ideas for Wren" }).isVisible()) && (await ideas.innerText()).includes("Made up by the AI, not in the story"), "the ideas are in a box of their own, saying the AI made them up");
  ok((await ideas.locator(".idea-row").count()) === 3 && (await facts.locator(".ef-marker").count()) === 0 && (await page.locator(".entry-waiting").count()) === 0, "…not marked on the facts, nor counted as changes from the text");
  const factsBox = await facts.boundingBox();
  ok((await ideas.boundingBox()).y > factsBox.y + factsBox.height - 1, "…below the facts");

  // Keep… from where Wren first appears (the default): it was always so
  const voice = ideas.locator(".idea-row", { hasText: "low and dry" });
  await voice.getByRole("button", { name: "Keep…" }).click();
  ok(await voice.getByRole("radio", { name: "where Wren first appears (“Root”): it was always so" }).isChecked(), "Keep… asks where it starts: where Wren first appears is the default");
  ok(await voice.getByRole("radio", { name: "“Chapter A” on" }).isVisible(), "…or the chapter it was suggested at");
  await voice.getByRole("button", { name: "Keep", exact: true }).click();
  await facts.locator(".fact-line", { hasText: "low and dry" }).waitFor();
  ok((await descAt(R)).includes("Voice: low and dry"), "kept from where Wren first appears: the root has it too");

  // Keep… from the chapter, after an edit
  const family = ideas.locator(".idea-row", { hasText: "an older brother" });
  await family.getByRole("button", { name: "Edit" }).click();
  await family.getByLabel("Fact", { exact: true }).fill("two older brothers");
  await family.getByRole("radio", { name: "“Chapter A” on" }).check();
  await family.getByRole("button", { name: "Keep", exact: true }).click();
  await facts.locator(".fact-line", { hasText: "two older brothers" }).waitFor();
  ok((await descAt(A)).includes("Family: two older brothers") && !(await descAt(R)).includes("Family"), "Edit, then Keep from the chapter: the edited fact starts there");

  // Discard
  await ideas.locator(".idea-row", { hasText: "deep water" }).getByRole("button", { name: "Discard" }).click();
  await ideas.waitFor({ state: "detached" });
  ok(!(await descAt(A)).includes("deep water"), "Discard drops the idea, and the box goes when none are left");

  // not in the writing page's drawer
  await send("PUT", "/api/queue/paused", { paused: false });
  await page.goto(`${BASE}/c/${A}/write?choice=${(await send("GET", `/api/chapters/${A}`)).choices[0].id}`);
  await page.locator(".site-menu > summary").click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const drawer = page.locator("aside.codex-drawer");
  await drawer.waitFor();
  await drawer.locator(".entry-card", { hasText: "Wren" }).click();
  await drawer.getByRole("heading", { name: "Wren" }).waitFor();
  ok((await drawer.getByRole("button", { name: /Flesh out/ }).count()) === 0, "not offered in the writing page's drawer");

  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(entryUrl(wren));
  await fleshButton.click();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the open form fits a phone screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await clearQueue();
  await send("PUT", "/api/queue/paused", { paused: false });
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
