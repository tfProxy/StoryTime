// The AI mark: a robot on chapters a run wrote (choice card, chapter meta line, outline), the notice on an
// unreviewed one, Mark reviewed / Mark this path reviewed, and the outline part "AI-written" in Settings.
// Set AI_MARKS_SHOTS=<dir> to also save screenshots (desktop and phone width) of the unreviewed state.
import fs from "node:fs";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const post = (url, body) => send("POST", url, body);
const getJson = (url) => send("GET", url);

const s = await post("/api/stories", { title: "Robot story", chapter: { title: "Owner root", body: "root", summary: "root sum", choices: ["a", "b", "c"] } });
const [ca, cb, cc] = (await getJson(`/api/chapters/${s.chapter_id}`)).choices;
const run = (await post("/api/ai-runs", { story_id: s.story_id, start_chapter_id: s.chapter_id, mode: "fill", options: {}, tasks: [] })).id;
const aiChapter = async (choice_id, title, choices = []) => (await post("/api/chapters", { choice_id, title, body: `${title} body`, summary: `${title} sum`, choices, ai_run_id: run })).chapter_id;
const A = await aiChapter(ca.id, "AI A", ["deeper"]);
const A1 = await aiChapter((await getJson(`/api/chapters/${A}`)).choices[0].id, "AI A1");
const B = await aiChapter(cb.id, "AI B");
const C = (await post("/api/chapters", { choice_id: cc.id, title: "Owner C", body: "c body", summary: "c sum" })).chapter_id;
// A finished run is not offered to anyone later.
await send("POST", `/api/ai-runs/${run}/claim`, { token: "ai-marks-token" });
await send("PATCH", `/api/ai-runs/${run}`, { token: "ai-marks-token", version: 1, status: "done" });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const settingsBefore = (await getJson("/api/settings")).settings;
const putSettings = (st) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(st) });
const until = async (fn, what) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};
const UN = "Written by AI, not reviewed", RV = "Written by AI";
const robots = (scope, name) => page.locator(`${scope} svg.ai-mark[role="img"][aria-label="${name}"]`).count();
const card = (label) => page.locator("a.choice-written", { hasText: new RegExp(`^${label}(?![a-z])`) });
const outlineUrl = `${BASE}/s/${s.story_id}/outline`;
const shots = process.env.AI_MARKS_SHOTS;
const shoot = async (name) => {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  for (const [tag, size] of [["desktop", { width: 1100, height: 800 }], ["phone", { width: 390, height: 780 }]]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${shots}/${name}-${tag}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
};

try {
  // the parent's choice cards
  await page.goto(`${BASE}/c/${s.chapter_id}`);
  await card("a").first().waitFor();
  ok((await card("a").first().locator(`svg.ai-mark[aria-label="${UN}"]`).count()) === 1 && (await card("b").first().locator(`svg.ai-mark[aria-label="${UN}"]`).count()) === 1, "AI-written choice cards show the unreviewed robot");
  ok((await card("c").first().locator("svg.ai-mark").count()) === 0, "…and the card for a chapter the owner wrote has none");
  ok((await page.locator(".ai-review-notice").count()) === 0 && (await page.locator("p.chapter-meta .ai-mark").count()) === 0, "the owner's own chapter has no notice and no robot");
  await shoot("parent");

  // an unreviewed chapter
  await page.goto(`${BASE}/c/${A1}`);
  await page.getByText("Written by AI, not reviewed yet.").waitFor();
  ok((await robots("p.chapter-meta", UN)) === 1, "an unreviewed chapter has the robot in its meta line");
  ok((await page.getByRole("button", { name: "Mark reviewed" }).count()) === 1 && (await page.getByRole("button", { name: "Mark this path reviewed" }).count()) === 1, "…and a notice with Mark reviewed and, as the chapter above is unreviewed too, Mark this path reviewed");
  await shoot("chapter");
  await page.goto(`${BASE}/c/${A}`);
  await page.getByText("Written by AI, not reviewed yet.").waitFor();
  ok((await page.getByRole("button", { name: "Mark this path reviewed" }).count()) === 0, "with nothing unreviewed above it, there is no Mark this path reviewed");
  ok((await page.getByRole("link", { name: "Write ahead with AI…" }).count()) === 1 || (await page.locator(`a[href="/c/${A}/write-ahead"]`).count()) >= 1, "the menu has Write ahead with AI…");
  await page.goto(`${BASE}/c/${C}`);
  ok((await page.locator(".ai-review-notice").count()) === 0 && (await page.locator(".ai-mark").count()) === 0, "a chapter the owner wrote has no robot and no notice");

  // the outline
  await page.goto(outlineUrl);
  await page.getByText(/chapters/).first().waitFor();
  ok((await robots(".outline-page", UN)) === 3 && (await robots(".outline-page", RV)) === 0, "the outline shows an unreviewed robot on each of the three AI chapters");
  ok((await page.locator(`#c-${C} .ai-mark`).count()) === 0 && (await page.locator(`#c-${s.chapter_id} > details > summary .ai-mark`).count()) === 0, "…and none on the owner's chapters");
  await shoot("outline");

  // Mark reviewed
  await page.goto(`${BASE}/c/${B}`);
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await page.getByText("Written by AI, not reviewed yet.").waitFor({ state: "detached" });
  ok((await robots("p.chapter-meta", RV)) === 1 && (await robots("p.chapter-meta", UN)) === 0, "Mark reviewed removes the notice and turns the meta robot to the reviewed look");
  await page.goto(`${BASE}/c/${s.chapter_id}`);
  ok((await card("b").first().locator(`svg.ai-mark[aria-label="${RV}"]`).count()) === 1 && (await card("a").first().locator(`svg.ai-mark[aria-label="${UN}"]`).count()) === 1, "…and the choice card, while a sibling's stays unreviewed");
  await page.goto(outlineUrl);
  ok((await robots(".outline-page", RV)) === 1 && (await robots(".outline-page", UN)) === 2, "…and the outline");
  const look = await page.evaluate(() => {
    const pick = (n) => { const e = document.querySelector(`.outline-page svg.ai-mark[aria-label="${n}"]`); const cs = getComputedStyle(e); return { color: cs.color, fill: e.querySelector("rect").getAttribute("fill") }; };
    return { un: pick("Written by AI, not reviewed"), rv: pick("Written by AI") };
  });
  ok(look.un.fill === "currentColor" && look.rv.fill === "none" && look.un.color !== look.rv.color, "the two looks differ: filled accent against outlined muted");

  // Mark this path reviewed
  await page.goto(`${BASE}/c/${A1}`);
  await page.getByRole("button", { name: "Mark this path reviewed" }).click();
  await page.getByText("Written by AI, not reviewed yet.").waitFor({ state: "detached" });
  await page.goto(`${BASE}/c/${s.chapter_id}`);
  ok((await card("a").first().locator(`svg.ai-mark[aria-label="${RV}"]`).count()) === 1, "Mark this path reviewed also marks the chapter above");
  await page.goto(outlineUrl);
  ok((await robots(".outline-page", UN)) === 0 && (await robots(".outline-page", RV)) === 3, "…so the outline has only reviewed robots");
  await shoot("outline-reviewed");

  // Settings › Outline › AI-written
  const part = page.getByRole("checkbox", { name: /^AI-written/ });
  await page.goto(`${BASE}/settings#outline`);
  await part.waitFor();
  ok(await part.isChecked(), "Settings › Outline has AI-written, ticked at first");
  await part.uncheck();
  await until(async () => (await getJson("/api/settings")).settings.outline.aiWritten === false, "AI-written to be turned off");
  await page.goto(outlineUrl);
  await page.getByText(/chapters/).first().waitFor();
  ok((await page.locator(".outline-page svg.ai-mark").count()) === 0, "with AI-written off the outline has no robots");
  await page.goto(`${BASE}/c/${A}`);
  ok((await page.locator("p.chapter-meta svg.ai-mark").count()) === 1, "…but the chapter page still does");
} finally {
  await putSettings(settingsBefore ?? {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
