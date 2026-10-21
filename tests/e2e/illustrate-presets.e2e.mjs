// Named picture presets: a story's drawing preset (Story details), a chapter's own (Illustrate page), each
// preset's checkpoint, LoRAs and Redraw strength in the workflow that is queued, the edit presets on the
// Edit tab, and the preset cards in Settings. Against the fake ComfyUI.
import fs from "node:fs";
import { comfySettings, launch } from "./browser.mjs";
import { EDIT_FILES, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3560;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Presets", chapter: { title: "The harbour", body: "Boats rocked in the harbour.", choices: [] } });
const { story_id: storyId, chapter_id: chapterId } = story;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 50, startDelay: 80, files: { ...EDIT_FILES, loras: ["styles/ink.safetensors", "hero.safetensors"] } });
const ink = { id: "ink", name: "Ink", checkpoint: "fake_sdxl_a.safetensors", workflow: "", loras: [{ name: "styles/ink.safetensors", strength: 0.8, on: true }], sampler: { steps: 12 }, denoise: 0.4 };
const plain = { id: "plain", name: "Plain", checkpoint: "fake_sdxl_b.safetensors", workflow: "", loras: [], sampler: {}, denoise: 0.55 };
const base = comfySettings({ url: comfy.url, count: 1 });
await putSettings({
  ...(before ?? {}),
  comfy: {
    ...base,
    drawPresets: [ink, plain],
    editPresets: [...base.editPresets, { id: "night", name: "Night", model: "qwen-image-edit", fast: true, loras: [{ name: "hero.safetensors", strength: 0.5, on: true }], tuning: { strength: 0.6 } }],
  },
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const items = page.locator(".candidates li.picture-tile");
const queue = page.getByRole("button", { name: "Queue", exact: true });
const drawMenu = page.locator(".comfy-generate").getByLabel("Drawing preset");
const strength = page.getByRole("slider", { name: "Strength" });
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
const chapterPreset = async () => (await call("GET", `/api/chapters/${chapterId}/picture-preset`)).draw_preset;
const settingsNow = async () => (await call("GET", "/api/settings")).settings.comfy;
/** Queues one picture and waits for it; returns the workflow sent. */
const makeOne = async () => {
  const mark = comfy.calls.length;
  const n = await items.count();
  await queue.click();
  await until(async () => (await items.count()) === n + 1 && (await ready()), "the picture");
  return prompts(mark)[0];
};

try {
  // ---- the story's preset, on its details page ----
  await page.goto(`${BASE}/s/${storyId}/details`);
  const storyMenu = page.locator("#pictures").getByLabel("Drawing preset");
  await until(async () => (await storyMenu.locator("option").count()) === 2, "the presets to be listed");
  ok(await storyMenu.inputValue() === "ink" && (await storyMenu.locator("option").allInnerTexts()).join() === "Ink,Plain", "Story details offers the drawing presets, starting on the top one");
  ok((await page.locator("#pictures").innerText()).includes("fake_sdxl_a · 1 LoRA"), "…and says what the chosen one draws with");
  await storyMenu.selectOption("plain");
  await page.getByRole("button", { name: "Save picture settings" }).click();
  await page.getByText("Picture settings saved.").waitFor();
  ok((await call("GET", `/api/stories/${storyId}`)).draw_preset === "plain", "choosing one there saves it with the story");

  // ---- the Illustrate page uses it, and a chapter can choose another ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("boats in a harbour");
  await drawMenu.waitFor();
  ok(await drawMenu.inputValue() === "plain" && (await drawMenu.locator("option").allInnerTexts()).join() === "Ink,Plain (the story's)", "the chapter uses the story's preset, marked as the story's");
  ok((await page.locator(".story-pictures").innerText()).includes("Plain"), "…which the story's picture settings name");
  let wf = await makeOne();
  ok(nodes(wf, "CheckpointLoaderSimple")[0].inputs.ckpt_name === "fake_sdxl_b.safetensors" && nodes(wf, "LoraLoader").length === 0 && nodes(wf, "KSampler")[0].inputs.steps === 30, "its pictures are drawn with its checkpoint and sampler, and no LoRAs");

  await drawMenu.selectOption("ink");
  ok(await until(async () => (await chapterPreset()) === "ink", "the chapter's preset to be saved"), "choosing another preset saves it for the chapter");
  ok((await call("GET", `/api/stories/${storyId}`)).draw_preset === "plain", "…leaving the story's as it was");
  const loraBoxes = page.locator(".draw-preset").getByRole("group", { name: "LoRAs" });
  ok((await page.locator(".draw-preset").innerText()).includes("fake_sdxl_a · 1 LoRA") && (await loraBoxes.innerText()).includes("ink (0.8)"), "the panel says what the preset draws with, and lists its LoRAs with a box each");
  wf = await makeOne();
  const lora = nodes(wf, "LoraLoader")[0];
  ok(nodes(wf, "CheckpointLoaderSimple")[0].inputs.ckpt_name === "fake_sdxl_a.safetensors" && lora?.inputs.lora_name === "styles/ink.safetensors" && lora.inputs.strength_model === 0.8 && lora.inputs.strength_clip === 0.8, "its pictures are drawn with its checkpoint and its LoRA, at its strength");
  ok(JSON.stringify(nodes(wf, "KSampler")[0].inputs.model) === JSON.stringify([Object.entries(wf).find(([, n]) => n === lora)[0], 0]) && nodes(wf, "KSampler")[0].inputs.steps === 12, "…the sampler using the LoRA's model, with the preset's steps");
  const log = (await jobs())[0];
  ok(log.checkpoint === "fake_sdxl_a.safetensors + styles/ink.safetensors (0.8)", "the job log keeps the checkpoint and the LoRA with its strength");
  ok((await page.locator(".chapter-pictures").innerText()).includes("fake_sdxl_a · 1 LoRA · 1344 × 768"), "…and the picture's caption says how many LoRAs it used");

  await page.reload();
  await drawMenu.waitFor();
  ok(await drawMenu.inputValue() === "ink", "after a refresh the chapter still uses its own preset");
  await loraBoxes.getByRole("checkbox").uncheck();
  ok(await until(async () => (await settingsNow()).drawPresets[0].loras[0].on === false, "the LoRA to be switched off"), "switching a LoRA off here saves it in the preset");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("boats in a harbour");
  wf = await makeOne();
  ok(nodes(wf, "LoraLoader").length === 0, "…and the next picture leaves it out");
  await loraBoxes.getByRole("checkbox").check();
  await until(async () => (await settingsNow()).drawPresets[0].loras[0].on === true, "the LoRA to be on again");

  // ---- Redraw starts at the preset's strength ----
  await items.first().getByRole("button", { name: "More" }).click();
  await items.first().getByRole("menuitem", { name: "Redraw from this" }).click();
  await strength.waitFor();
  ok(await strength.inputValue() === "0.4" && (await page.locator(".comfy-generate").innerText()).includes("It starts at the preset's default (0.40)"), "Redraw's strength starts at the preset's Redraw strength");
  await drawMenu.selectOption("plain");
  ok(await until(async () => (await strength.inputValue()) === "0.55", "the strength to follow the preset"), "…and follows the preset chosen");
  ok(await until(async () => (await chapterPreset()) === null, "the chapter to follow the story"), "choosing the story's own preset again makes the chapter follow the story");
  await drawMenu.selectOption("ink");
  await strength.fill("0.25");
  wf = await makeOne();
  ok(nodes(wf, "KSampler")[0].inputs.denoise === 0.25 && nodes(wf, "LoraLoader").length === 1, "a redraw uses the strength moved here, and the preset's LoRAs");
  await page.reload();
  await strength.waitFor();
  ok(await strength.inputValue() === "0.25", "…and the moved strength comes back after a refresh");

  // ---- edit presets ----
  await items.first().getByRole("button", { name: "More" }).click();
  await items.first().getByRole("menuitem", { name: "Edit this" }).click();
  const editMenu = page.getByLabel("Edit preset");
  await editMenu.waitFor();
  ok((await editMenu.locator("option").allInnerTexts()).join("|") === "Default|Night|Default", "the Edit tab offers each model's presets");
  await editMenu.selectOption("night");
  ok(await until(async () => (await strength.inputValue()) === "0.6", "the Night preset's strength"), "a preset's strength is where the Edit tab starts");
  ok((await page.getByRole("group", { name: "LoRAs" }).innerText()).includes("hero (0.5)"), "…and its LoRAs are listed");
  await page.getByRole("textbox", { name: "What to change" }).fill("make it night");
  wf = await makeOne();
  ok(nodes(wf, "LoraLoaderModelOnly").map((n) => n.inputs.lora_name).join() === "hero.safetensors" && nodes(wf, "KSampler")[0].inputs.denoise === 0.6, "an edit uses the chosen preset's LoRAs and strength");
  await editMenu.selectOption("qwen-image-edit");
  ok(await until(async () => (await strength.inputValue()) === "1", "the Default preset's strength"), "another preset starts at its own strength");

  // ---- Settings: a tab of presets for each edit model ----
  await page.goto(`${BASE}/settings#preset-night`);
  const night = page.locator("#preset-night");
  await night.waitFor();
  ok(await page.getByRole("tab", { name: "Qwen edit" }).getAttribute("aria-selected") === "true" && await night.evaluate((d) => d.open), "a preset's address opens its tab, with its card open");
  const qwenCards = page.locator("#panel-edit-qwen-image-edit details.preset-card");
  ok((await qwenCards.count()) === 2 && (await night.locator(":scope > summary").innerText()).includes("fast · 1 LoRA · strength 0.60"), "the Qwen edit tab has a card per Qwen preset, each summing it up");
  ok(await page.locator("#panel-edit-flux-kontext details.preset-card").count() === 1, "…and the Flux edit tab its own");
  await page.getByRole("button", { name: "New Qwen-Image-Edit preset" }).click();
  await until(async () => (await qwenCards.count()) === 3, "a third Qwen preset");
  const fresh = qwenCards.nth(2);
  await fresh.getByLabel("Preset name").fill("Portrait");
  ok(await until(async () => (await settingsNow()).editPresets.some((p) => p.name === "Portrait" && p.model === "qwen-image-edit"), "the new preset to be saved"), "New Qwen-Image-Edit preset adds one for that model, which can be named");
  page.once("dialog", (d) => d.accept());
  await fresh.getByRole("button", { name: "Delete" }).click();
  ok(await until(async () => !(await settingsNow()).editPresets.some((p) => p.name === "Portrait"), "the preset to be deleted"), "…and deleted again");
  ok(await page.locator("#panel-edit-flux-kontext details.preset-card").getByRole("button", { name: "Delete", includeHidden: true }).isDisabled(), "a model's last preset can't be deleted");

  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    for (const [width, height] of [[1000, 1300], [390, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}/settings#drawing`);
      await page.locator("#preset-ink").waitFor();
      if (!(await page.locator("#preset-ink").evaluate((d) => d.open))) await page.locator("#preset-ink > summary").click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-drawing-${width}.png`, fullPage: true });
      ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `at ${width}px the Drawing tab does not scroll sideways`);
      await page.goto(`${BASE}/settings#edit-qwen-image-edit`);
      await page.locator("#preset-night").waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-qwen-${width}.png`, fullPage: true });
      await page.goto(`${BASE}/c/${chapterId}/illustrate`);
      await page.getByRole("heading", { name: "Make pictures" }).waitFor();
      await page.waitForTimeout(500);
      // A refresh brings back the picture being edited; the drawing preset shows without one.
      const clear = page.getByRole("button", { name: "Clear starting picture" });
      if (await clear.count()) await clear.click();
      await drawMenu.waitFor();
      await page.waitForTimeout(400);
      await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-presets-${width}.png` });
      ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `at ${width}px the Illustrate page does not scroll sideways`);
    }
  }
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
