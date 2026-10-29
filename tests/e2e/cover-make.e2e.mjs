// Making a story's cover on its cover page (/s/<id>/cover): the link from the details page, the "Write from"
// choices, a prompt written by the (fake) model from the summary or a path, the boxes being kept, pictures made
// on a fake ComfyUI at the cover size, using one as the cover, the header's queue, and a story with no chapters.
import http from "node:http";
import { comfySettings, launch, useMockAi } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3573;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const settingsNow = async () => (await get("/api/settings")).settings;
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a fake model that records what it was asked ----
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    if (!body.messages) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [] })); }
    calls.push({ system: body.messages[0].content, user: body.messages.at(-1).content });
    res.setHeader("content-type", "text/event-stream");
    const reply = '{"scene":"A tall lighthouse.","prompt":"a lighthouse on a cliff at dusk","negative":"text, watermark"}';
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

// ---- a story with two chapters, and one with none ----
const title = "Beacon saga";
const created = await post("/api/stories", { title, premise: "A keeper guards a lonely beacon.", chapter: { title: "The lamp", body: "Zephyr climbed the stairs of the lamp room.", choices: ["Go down"] } });
const storyId = created.story_id;
const choice = (await get(`/api/chapters/${created.chapter_id}`)).choices[0];
const second = (await post("/api/chapters", { choice_id: choice.id, title: "The cellar", body: "Marigold water rose in the cellar.", choices: [] })).chapter_id;
const empty = await post("/api/stories", { title: "Empty cover tale", premise: "A story not started yet." });
const emptyId = empty.story_id;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const ai = await useMockAi(BASE, { favorites: [], imagePromptModel: null });
const before = await settingsNow();
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 3, stepDelay: 100, startDelay: 100 });
await putSettings({ ...before, comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });
const widthBefore = (await settingsNow()).comfy;

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); pageErrors.push(e.message); failed = true; });
const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
const negativeBox = page.getByRole("textbox", { name: "Negative prompt", exact: true });
const source = page.getByLabel("Write the cover from");
const pathEnd = page.locator("#cover-path-end");
const pickPathEnd = async (chapterTitle) => {
  await pathEnd.click();
  await page.getByRole("dialog", { name: "Choose a chapter" }).getByRole("button", { name: new RegExp(`^${chapterTitle}`) }).click();
};
const queueButton = page.getByRole("button", { name: "Queue", exact: true });
const size = page.getByLabel("Size");
const tiles = page.locator(".candidates li.picture-tile");
const card = (name) => page.locator(".image-editor", { has: page.getByRole("heading", { name }) });
const header = page.locator(".site-header");
const badge = header.locator(".picture-queue-button");
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");
const openCover = async (id = storyId) => {
  await page.goto(`${BASE}/s/${id}/cover`);
  await page.getByRole("heading", { name: "Cover prompt" }).waitFor();
};
const writePrompt = async () => {
  const n = calls.length;
  await page.getByRole("button", { name: /^Write (prompt|again)$/ }).first().click();
  await until(() => calls.length === n + 1 && page.getByRole("button", { name: "Write again" }).isVisible(), "the prompt to be written", 60);
  return calls.at(-1);
};

try {
  // ---- from the details page ----
  await page.goto(`${BASE}/s/${storyId}/details`);
  const link = page.getByRole("link", { name: "Make a cover" });
  await link.waitFor();
  ok((await link.getAttribute("href")) === `/s/${storyId}/cover`, "the story details page has a Make a cover link to the cover page");
  await link.click();
  await page.waitForURL(`${BASE}/s/${storyId}/cover`);
  ok(await page.getByRole("heading", { name: "Make a cover", level: 1 }).isVisible() && await page.getByRole("heading", { name: "Cover prompt" }).isVisible(), "the cover page has the heading Make a cover and a Cover prompt panel");

  // ---- Write from ----
  ok((await source.locator("option").allInnerTexts()).join("|") === "The summary and codex|The first chapter|A path through the story", "Write from offers the summary, the first chapter and a path");
  ok((await source.inputValue()) === "premise" && (await pathEnd.count()) === 0, "…and starts on the summary, with no path menu");
  await source.selectOption({ label: "A path through the story" });
  await pathEnd.click();
  const pathPanel = page.getByRole("dialog", { name: "Choose a chapter" });
  ok((await pathPanel.locator(".chapter-tree-title").allInnerTexts()).join("|") === "The lamp|The cellar", "choosing a path shows the path-end picker, listing the story's chapters as a tree");
  await page.keyboard.press("Escape");
  ok((await pathEnd.innerText()).includes("The cellar"), "…which starts on the last chapter");

  // ---- writing the prompt ----
  await page.getByRole("button", { name: "Write prompt", exact: true }).waitFor();
  const fromPath = await writePrompt();
  ok((await promptBox.inputValue()).startsWith("a lighthouse on a cliff at dusk") && (await negativeBox.inputValue()) === "text, watermark", "Write prompt with the fake model fills the Prompt and Negative prompt boxes");
  ok(fromPath.user.includes("A keeper guards a lonely beacon.") && fromPath.user.includes("Marigold water rose in the cellar.") && fromPath.user.includes("Zephyr climbed"), "for a path, the request has the premise and the chapters' text, including the second chapter");
  await source.selectOption({ label: "The summary and codex" });
  const fromSummary = await writePrompt();
  ok(fromSummary.user.includes("A keeper guards a lonely beacon.") && !fromSummary.user.includes("Marigold") && !fromSummary.user.includes("Zephyr"), "for the summary, the request has the premise but not the chapters' text");

  // ---- kept for next time ----
  await source.selectOption({ label: "A path through the story" });
  await pickPathEnd("The lamp");
  await pickPathEnd("The cellar");
  await promptBox.fill("a kept cover prompt");
  await negativeBox.fill("a kept negative");
  await page.waitForTimeout(1200); // (the boxes are saved after a short wait)
  await page.reload();
  await page.getByRole("heading", { name: "Cover prompt" }).waitFor();
  ok((await promptBox.inputValue()) === "a kept cover prompt" && (await negativeBox.inputValue()) === "a kept negative", "after a reload the Prompt and Negative prompt boxes come back");
  ok((await source.inputValue()) === "path" && (await pathEnd.innerText()).includes("The cellar"), "…and so do the source and the chosen path end");

  // ---- making a picture at the cover size ----
  ok(((await size.locator("option").first().evaluate((o) => o.textContent)).replace(/\s+/g, " ")).includes("Book") && (await size.locator("option").first().evaluate((o) => o.textContent)).includes("832 × 1216"), "the Size menu lists the book size first");
  ok((await size.inputValue()) === "832x1216", "…and it is 832 × 1216 by default");
  await queueButton.click();
  ok(await until(async () => (await tiles.count()) === 1, "the picture", 100), "Queue makes a picture that appears in the Pictures panel");
  await until(() => posted().length === 1, "the job to be sent", 30);
  const jobs = (await get(`/api/picture-jobs?cover=${storyId}`)).jobs;
  ok(await until(async () => (await get(`/api/picture-jobs?cover=${storyId}`)).jobs.length === 1, "the job to be recorded", 50), "the finished job is recorded for the story's cover");
  const job = (await get(`/api/picture-jobs?cover=${storyId}`)).jobs[0] ?? jobs[0];
  ok(job && job.chapter_id === null && job.moment === "cover" && job.width === 832 && job.height === 1216, `…with no chapter, the moment cover and the size 832 × 1216 (${job?.chapter_id}, ${job?.moment}, ${job?.width} × ${job?.height})`);
  const prefix = Object.values(posted()[0].body.prompt).find((n) => n.class_type === "SaveImage")?.inputs.filename_prefix;
  ok(prefix === `StoryTime/${storyId}/cover`, `ComfyUI was told to file the picture under StoryTime/<story>/cover (${prefix})`);

  // ---- the chapters' size is untouched ----
  await size.selectOption("768x1344");
  await until(async () => (await settingsNow()).comfy.coverWidth === 768, "the cover size to be saved");
  const after = (await settingsNow()).comfy;
  ok(after.coverWidth === 768 && after.coverHeight === 1344, "choosing another Size on the cover page changes the cover size in the settings");
  ok(after.width === widthBefore.width && after.height === widthBefore.height, `…but not the chapters' size (${after.width} × ${after.height})`);
  await size.selectOption("832x1216");
  await until(async () => (await settingsNow()).comfy.coverWidth === 832, "the cover size to be put back");

  // ---- using it as the cover ----
  await tiles.first().getByRole("button", { name: "More" }).click();
  const items = await tiles.first().getByRole("menuitem").allInnerTexts();
  ok(items.some((t) => t.trim() === "Use as cover") && !items.some((t) => /header|footer/i.test(t)), `the picture's ☰ menu has Use as cover and no header or footer items (${items.join("|")})`);
  await tiles.first().getByRole("menuitem", { name: "Use as cover" }).click();
  await page.getByText("Saved as the story's cover.").waitFor();
  const saved = await fetch(`${BASE}/api/stories/${storyId}/cover`);
  ok(saved.status === 200 && (saved.headers.get("content-type") ?? "").startsWith("image/"), "choosing it saves the story's cover (the cover address answers with an image)");
  const preview = card("Cover").locator("img.image-editor-preview");
  await preview.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
  ok(await preview.evaluate((i) => i.naturalWidth > 0), "the Cover card shows the picture");
  await tiles.first().locator(".picture-in-use").waitFor();
  ok((await tiles.first().locator(".picture-in-use").innerText()).trim() === "Cover", "the picture's tile says Cover");
  ok(await until(async () => (await get(`/api/picture-jobs?cover=${storyId}`)).jobs[0].marks[0] === "pinned", "the pin"), "…and the picture is pinned (the server has the mark)");

  // ---- the header's queue ----
  comfy.setMode({ steps: 10, stepDelay: 200 });
  await promptBox.fill("a lighthouse, stormy sea");
  await queueButton.click();
  await until(() => posted().length === 2, "the second job to be sent", 60);
  await header.getByRole("link", { name: "StoryTime", exact: true }).click();
  await page.waitForURL(`${BASE}/`);
  await badge.waitFor();
  await badge.click();
  const panel = page.getByRole("region", { name: "Queue" });
  const row = panel.getByRole("listitem", { name: /^Cover: (being made|ready)$/ });
  await row.waitFor();
  ok(true, "on the story list the header's job list has a row named Cover");
  ok((await row.innerText()).includes(title), "…with the story's title");
  const ready = panel.getByRole("listitem", { name: "Cover: ready" });
  await ready.waitFor({ timeout: 15000 });
  await ready.getByRole("link", { name: "Open", exact: true }).click();
  await page.waitForURL(`${BASE}/s/${storyId}/cover`);
  ok(true, "…and its Open link goes back to the cover page");
  await page.getByRole("heading", { name: "Cover prompt" }).waitFor();

  // ---- a story with no chapters ----
  await openCover(emptyId);
  const optionOff = async (name) => source.locator("option", { hasText: name }).evaluate((o) => o.disabled);  ok((await optionOff("A path through the story")) && (await optionOff("The first chapter")) && !(await optionOff("The summary and codex")), "a story with no chapters has the path and first chapter options disabled");
  ok(await page.getByText("The story has no chapters yet, so the cover is written from its summary.").isVisible() && (await source.inputValue()) === "premise", "…and the page says the cover is written from the summary");

} finally {
  await ai.restore();
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
  mock.close();
}
ok(pageErrors.length === 0, "no page errors");
process.exit(failed ? 1 : 0);
