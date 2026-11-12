// The writing desk's Illustrate mode (/c/<id>/desk?side=illustrate), against a fake ComfyUI and a fake model: the
// Codex | Illustrate switch (kept in the address), the picture controls in the side column in order, Write prompt,
// Queue making pictures, one saved as the Header and shown in the story column, the chapter folded below the pictures,
// no entry column, and Codex again bringing back the codex, the open entry and the editor as they were.
import http from "node:http";
import { comfySettings, launch, useMockAi } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3582;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a fake model that writes the picture prompt ----
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    if (!body.messages) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [] })); }
    calls.push({ user: body.messages.at(-1).content, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    const reply = '```json\n{"scene":"The keeper climbs.","prompt":"a keeper climbing a lighthouse stair","negative":"blurry"}\n```';
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

const story = await call("POST", "/api/stories", { title: "Desk Lights", premise: "A keeper and a storm.", chapter: { title: "The lamp", body: "Mara climbed the stairs to light the lamp.\n\nThe storm came in from the sea.", choices: [] } });
const chapterId = story.chapter_id;
await call("POST", "/api/codex", { anchor_chapter_id: chapterId, op: "create", name: "Mara", type: "character", content: "" });
const before = (await call("GET", "/api/settings")).settings;
const ai = await useMockAi(BASE, { imagePromptModel: null });
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 4, stepDelay: 50 });
const withAi = (await call("GET", "/api/settings")).settings;
await fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...withAi, comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 2 }) }) });

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  // ---- the switch ----
  await page.goto(`${BASE}/c/${chapterId}/desk`);
  await page.getByRole("heading", { name: "Edit “The lamp”" }).waitFor();
  await page.waitForLoadState("load");
  const illustrate = page.getByRole("button", { name: "Illustrate", exact: true });
  ok(await illustrate.isEnabled() && (await illustrate.getAttribute("title")) === null, "Illustrate is offered for a posted chapter, with no 'not on the desk yet' note");
  // An entry open in Codex mode, to see it back afterwards.
  await page.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { hasText: "Mara" }).click();
  await page.getByRole("region", { name: "Codex entry: Mara" }).waitFor();
  // A mark on the editor's title box (not an edit, which would leave a draft), to see the same editor back afterwards.
  await page.getByLabel("Chapter title").evaluate((e) => (e.dataset.mark = "kept"));
  await illustrate.click();
  const side = page.locator("aside.desk-side");
  await page.getByRole("heading", { name: "Illustrate “The lamp”" }).waitFor();
  ok(new URL(page.url()).searchParams.get("side") === "illustrate", "Illustrate is kept in the address (?side=illustrate)");
  ok((await illustrate.getAttribute("aria-pressed")) === "true" && (await side.getAttribute("aria-label")) === "Illustrate", "the side column is in Illustrate mode");
  ok((await page.locator("section.desk-entry").count()) === 0, "the entry column is closed");
  ok(!(await page.getByRole("heading", { name: "Edit “The lamp”" }).isVisible()) && (await side.getByRole("searchbox", { name: "Search entries" }).count()) === 0, "the editor and the codex list are out of sight");

  // ---- the controls, in order ----
  const promptBox = side.getByRole("textbox", { name: "Prompt", exact: true });
  await promptBox.waitFor();
  await side.getByRole("button", { name: "Queue", exact: true }).waitFor();
  const at = async (locator) => locator.first().boundingBox();
  const parts = [
    ["moment", side.getByLabel("Moment to show")],
    ["what to show", side.locator("label", { hasText: "What to show" }).locator("textarea")],
    ["model", side.getByLabel("Model for picture prompts")],
    ["prompt", promptBox],
    ["always include", side.locator("label", { hasText: "Always include" }).locator("textarea")],
    ["negative", side.getByRole("textbox", { name: "Negative prompt", exact: true })],
    ["size", side.getByLabel("Size", { exact: true })],
    ["pictures per click", side.getByLabel("Pictures per click")],
    ["drawing preset", side.getByLabel("Drawing preset")],
    ["seed", side.getByText("Keep seed")],
    ["instruct", side.getByRole("heading", { name: "Instruct" })],
  ];
  const boxes = [];
  for (const [name, l] of parts) boxes.push([name, await at(l)]);
  const missing = boxes.filter(([, b]) => !b).map(([n]) => n);
  ok(missing.length === 0, "the side column has every control: " + (missing.join(", ") || "all"));
  const outOfOrder = boxes.filter(([, b], i) => i > 0 && b && boxes[i - 1][1] && b.y < boxes[i - 1][1].y - 1).map(([n]) => n);
  ok(missing.length === 0 && outOfOrder.length === 0, "…in order: moment, what to show, model, Prompt, always include, negative, size, pictures per click, drawing preset, seed, Instruct " + JSON.stringify(outOfOrder));
  const model = await at(side.getByLabel("Model for picture prompts"));
  const write = await at(side.getByRole("button", { name: "Write prompt", exact: true }));
  const sideBox = await side.boundingBox();
  ok(Math.abs(write.y + write.height / 2 - (model.y + model.height / 2)) < 12 && write.x > model.x && sideBox.x + sideBox.width - (write.x + write.width) < 40, "Write prompt is on the model's row, at its right");
  ok(write.y + write.height <= (await at(promptBox)).y, "…above the Prompt box");
  const size = await at(side.getByLabel("Size", { exact: true }));
  const scale = await at(side.getByLabel("Scale by"));
  const perClick = await at(side.getByLabel("Pictures per click"));
  const queue = await at(side.getByRole("button", { name: "Queue", exact: true }));
  ok(scale.x > size.x && Math.abs(scale.y - size.y) < 12, "the scale is beside the size");
  ok(Math.abs(perClick.y - queue.y) < 12 && perClick.x < queue.x && perClick.y > size.y, "under them, pictures per click and then Queue");
  ok(queue.y < (await at(side.getByLabel("Drawing preset"))).y, "Queue comes before the drawing preset");
  ok((await page.locator(".generate-dock").count()) === 0, "there is no dock at the bottom of the screen: Size and Queue are in the column");

  // ---- the pictures and the chapter in the story column ----
  const story_ = page.locator(".desk-pictures");
  const cards = story_.locator(".image-editor h2");
  ok((await cards.allInnerTexts()).join("|") === "Header picture|Middle picture|Footer picture", "the story column shows the Header, Middle and Footer pictures");
  const cardBoxes = await Promise.all([0, 1, 2].map((i) => story_.locator(".image-editor").nth(i).boundingBox()));
  ok(cardBoxes.every((b) => Math.abs(b.y - cardBoxes[0].y) < 2), "…side by side");
  const chapterPanel = story_.locator(".illustrate-chapter");
  ok((await chapterPanel.boundingBox()).y > cardBoxes[0].y + cardBoxes[0].height, "the chapter is below the pictures");
  ok(!(await chapterPanel.getByText("The storm came in from the sea.").isVisible()) && (await chapterPanel.getByText("Show the whole chapter").isVisible()), "…folded");
  await chapterPanel.getByText("Show the whole chapter").click();
  await chapterPanel.getByText("The storm came in from the sea.").waitFor();
  ok(true, "…and opens to the whole text");
  ok(await chapterPanel.getByText("Codex entries used: Mara").isVisible(), "the codex entries the prompt uses are listed under the chapter");

  // ---- Write prompt ----
  await side.getByRole("button", { name: "Write prompt", exact: true }).click();
  await side.getByRole("button", { name: "Write again" }).waitFor();
  ok(calls.length === 1 && calls[0].user.includes("Mara climbed the stairs"), "Write prompt asks the model, with the chapter");
  ok((await promptBox.inputValue()).startsWith("a keeper climbing a lighthouse stair"), "…and the prompt fills the Prompt box: " + (await promptBox.inputValue()));

  // ---- Queue ----
  await side.getByRole("button", { name: "Queue", exact: true }).click();
  const tiles = story_.locator(".candidates li.picture-tile");
  const pending = story_.locator(".comfy-pending-tile");
  await until(async () => (await tiles.count()) > 0 && (await pending.count()) === 0, "the pictures", 150);
  const made = await tiles.count();
  const perClickNow = Number(await side.getByLabel("Pictures per click").inputValue());
  ok(made > 0 && made === perClickNow, `Queue makes the pictures (${made}, at ${perClickNow} per click), shown in the story column`);
  ok(comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").length >= 1, "…sent to ComfyUI by the queue");
  await page.waitForFunction(() => [...document.querySelectorAll(".desk-pictures .candidates img")].every((i) => i.complete && i.naturalWidth > 0));

  // ---- saving one as the Header ----
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Use as header picture" }).click();
  await page.getByText("Saved as the header picture.").waitFor();
  const header = story_.locator(".image-editor", { has: page.getByRole("heading", { name: "Header picture" }) }).locator("img.image-editor-preview");
  await header.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".desk-pictures .image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
  ok((await fetch(`${BASE}/api/chapters/${chapterId}/images/header`)).status === 200, "Use as header picture saves it as the chapter's header");
  ok(await header.isVisible(), "…and the Header card in the story column shows it");
  ok((await illustrate.getAttribute("aria-pressed")) === "true", "…with the desk still in Illustrate mode after the page refreshed");

  // ---- back to Codex ----
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await page.getByRole("heading", { name: "Edit “The lamp”" }).waitFor();
  ok(new URL(page.url()).searchParams.get("side") === null, "Codex takes ?side=illustrate out of the address");
  ok(await page.locator("aside.desk-side").getByRole("searchbox", { name: "Search entries" }).isVisible(), "the codex list is back");
  ok(await page.getByRole("region", { name: "Codex entry: Mara" }).isVisible(), "…and the entry that was open");
  ok((await page.getByLabel("Chapter title").getAttribute("data-mark")) === "kept", "…and the editor, as it was (kept, not made again, so an unsaved edit stays)");
  ok((await page.locator(".desk-pictures").count()) === 0, "the pictures are gone from the story column");

  // ---- opened in Illustrate mode ----
  await page.goto(`${BASE}/c/${chapterId}/desk?side=illustrate`);
  await page.getByRole("heading", { name: "Illustrate “The lamp”" }).waitFor();
  ok((await page.locator(".desk-pictures img.image-editor-preview").count()) === 1, "?side=illustrate opens the desk in Illustrate mode, with the header shown");
  await context.close();

  // ---- a phone ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await phone.newPage();
  p2.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await p2.goto(`${BASE}/c/${chapterId}/desk?side=illustrate`);
  await p2.getByRole("heading", { name: "Illustrate “The lamp”" }).waitFor();
  await p2.getByRole("button", { name: "Queue", exact: true }).waitFor();
  const wide = await p2.evaluate(() => [...document.querySelectorAll(".desk *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 5));
  ok(wide.length === 0, "on a phone nothing is wider than the screen: " + JSON.stringify(wide));
  await phone.close();
} finally {
  // Take this file's queue items off, so the next file starts clean.
  for (const item of (await call("GET", "/api/queue")).items ?? []) await fetch(`${BASE}/api/queue/items/${item.key}`, { method: "DELETE" });
  await browser.close();
  await ai.restore();
  await fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(before ?? {}) });
  await comfy.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
