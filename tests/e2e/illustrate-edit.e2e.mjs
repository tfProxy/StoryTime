// Editing a picture by instruction on the Illustrate page: "Edit this" in a picture's ☰ menu (off until
// ComfyUI has an edit model), the Settings "Check setup" report, the Redraw and Edit tabs sharing one
// starting picture, the workflows queued for Qwen-Image-Edit and FLUX.1 Kontext, what the job log keeps,
// editing an edit, and a ComfyUI missing a node. The fake ComfyUI lists the model files it is given.
import { launch } from "./browser.mjs";
import { EDIT_FILES, LIGHTNING_LORA, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3558;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Edits", chapter: { title: "The forge", body: "The smith wore a shirt with a logo.", choices: [] } });
const chapterId = story.chapter_id;
await call("PATCH", `/api/stories/${story.story_id}`, { checkpoint: "fake_sdxl_a.safetensors" });
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100 });
await putSettings({ ...(before ?? {}), comfy: { url: comfy.url, workflow: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, count: 2, denoise: 0.55, editModel: "qwen-image-edit" } });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const items = page.locator(".candidates li.picture-tile");
const thumb = page.getByRole("img", { name: "Starting picture" });
const strength = page.getByRole("slider", { name: "Strength" });
const redrawTab = page.getByRole("tab", { name: "Redraw" });
const editTab = page.getByRole("tab", { name: "Edit" });
const modelMenu = page.getByLabel("Edit model");
const instruction = page.getByRole("textbox", { name: "What to change" });
const makeEdit = page.getByRole("button", { name: "Queue", exact: true });
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
const openMenu = async (tile) => {
  await tile.getByRole("button", { name: "More" }).click();
  return tile.getByRole("menu");
};
const choose = async (tile, item) => {
  const menu = await openMenu(tile);
  await menu.getByRole("menuitem", { name: item }).click();
};
const showAll = async () => {
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  await items.first().waitFor();
};

try {
  // ---- no edit model installed ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a smith at the forge");
  await makeEdit.click();
  await until(async () => (await items.count()) === 1 && (await ready()), "a picture");
  let menu = await openMenu(items.first());
  const editItem = menu.getByRole("menuitem", { name: "Edit this" });
  await until(async () => /No edit model is installed/.test((await editItem.getAttribute("title")) ?? ""), "the edit check to finish");
  ok(await editItem.getAttribute("aria-disabled") === "true", "with no edit model in ComfyUI, Edit this is in the menu but can't be chosen");
  ok(/Check setup/.test(await editItem.getAttribute("title")), "…and its tooltip points at Settings' Check setup");
  await editItem.click({ force: true });
  ok(await thumb.count() === 0, "…choosing it does nothing");
  await page.keyboard.press("Escape");

  // ---- Settings: Check setup ----
  await page.goto(`${BASE}/settings`);
  const report = page.locator(".comfy-check");
  await page.getByRole("button", { name: "Check setup" }).click();
  await report.waitFor();
  const text = await report.innerText();
  ok(text.includes("Connected to ComfyUI 0.3.99") && text.includes("2 checkpoints in models/checkpoints") && text.includes("ComfyUI has every node the picture workflow uses"), "Check setup says ComfyUI's version, the checkpoints and that the picture workflow's nodes are there");
  ok(text.includes("Qwen-Image-Edit: not ready") && text.includes("FLUX.1 Kontext: not ready"), "…and that neither edit model is ready");
  ok(text.includes("qwen_image_edit_2509_fp8_e4m3fn.safetensors in ComfyUI/models/diffusion_models") && text.includes("ae.safetensors in ComfyUI/models/vae"), "…naming each missing file and the folder it goes in");
  ok(await report.getByRole("link", { name: "Step-by-step setup" }).getAttribute("href") === "https://github.com/tfProxy/StoryTime#edit-models-in-comfyui", "…with a link to the setup steps");

  comfy.setMode({ files: { ...EDIT_FILES, diffusion_models: ["qwen_image_edit_2509_fp8_e4m3fn.safetensors"] } });
  await page.getByRole("button", { name: "Check setup" }).click();
  await until(async () => (await report.innerText()).includes("Qwen-Image-Edit: ready"), "the second check");
  ok((await report.innerText()).includes("FLUX.1 Kontext: not ready") && (await report.innerText()).includes("flux1-dev-kontext_fp8_scaled.safetensors in ComfyUI/models/diffusion_models"), "with only Qwen's model added, Qwen is ready and Kontext still misses its model");

  comfy.setMode({ files: EDIT_FILES });
  await page.getByRole("button", { name: "Check setup" }).click();
  await until(async () => (await report.innerText()).includes("FLUX.1 Kontext: ready"), "the third check");
  ok((await report.innerText()).includes("Qwen-Image-Edit: ready"), "with every file there, both are ready");
  ok((await report.innerText()).includes(`Lightning LoRA (optional, for fast edits): not installed. For edits several times faster, put ${LIGHTNING_LORA} in ComfyUI/models/loras.`), "…and the optional Lightning LoRA is said to be missing, with where it goes");
  comfy.setMode({ files: { ...EDIT_FILES, loras: [LIGHTNING_LORA] } });
  await page.getByRole("button", { name: "Check setup" }).click();
  await until(async () => (await report.innerText()).includes(`Lightning LoRA (optional, for fast edits): ${LIGHTNING_LORA} (4 steps)`), "the check with the LoRA");
  ok(true, "with the LoRA installed, the check names it and its steps");
  comfy.setMode({ files: EDIT_FILES });

  comfy.setMode({ missingNodes: ["TextEncodeQwenImageEditPlus"] });
  await page.getByRole("button", { name: "Check setup" }).click();
  await until(async () => (await report.innerText()).includes("Qwen-Image-Edit: not ready"), "the check with a missing node");
  ok((await report.innerText()).includes("ComfyUI doesn't have the nodes TextEncodeQwenImageEditPlus. Update ComfyUI."), "a missing node makes its model not ready, and says to update ComfyUI");
  comfy.setMode({ missingNodes: [] });

  // ---- Edit this ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await showAll();
  menu = await openMenu(items.first());
  await until(async () => (await menu.getByRole("menuitem", { name: "Edit this" }).getAttribute("aria-disabled")) === null, "Edit this to be offered");
  await menu.getByRole("menuitem", { name: "Edit this" }).click();
  await thumb.waitFor();
  ok(await editTab.getAttribute("aria-selected") === "true" && await strength.inputValue() === "1", "Edit this shows the picture with the Edit tab chosen and a Strength slider at full strength");
  ok((await modelMenu.locator("option").allInnerTexts()).join("|") === "Qwen-Image-Edit|FLUX.1 Kontext" && await modelMenu.inputValue() === "qwen-image-edit", "…both models are offered, Qwen first as last used");
  ok(await makeEdit.isDisabled(), "…and Queue waits for an instruction");
  const startSrc = await thumb.getAttribute("src");

  // the tabs share the starting picture
  await redrawTab.click();
  ok(await strength.isVisible() && await thumb.getAttribute("src") === startSrc && await makeEdit.isVisible(), "the Redraw tab shows the Strength slider for the same picture");
  await editTab.click();
  await instruction.fill("remove the logo on his shirt");
  await redrawTab.click();
  await editTab.click();
  ok(await instruction.inputValue() === "remove the logo on his shirt", "…and going back to Edit keeps the instruction");

  let mark = comfy.calls.length;
  await makeEdit.click();
  await until(async () => (await items.count()) === 2 && (await ready()), "the edit");
  let wf = prompts(mark)[0];
  ok(nodes(wf, "UNETLoader")[0]?.inputs.unet_name === "qwen_image_edit_2509_fp8_e4m3fn.safetensors" && nodes(wf, "CLIPLoader")[0]?.inputs.clip_name === "qwen_2.5_vl_7b_fp8_scaled.safetensors", "Queue in the Edit tab queues the Qwen workflow with the files ComfyUI has");
  ok(nodes(wf, "TextEncodeQwenImageEditPlus").some((n) => n.inputs.prompt === "remove the logo on his shirt") && nodes(wf, "CheckpointLoaderSimple").length === 0, "…with the instruction, and no checkpoint");
  ok(/^storytime-start-/.test(nodes(wf, "LoadImage")[0].inputs.image) && nodes(wf, "ImageScale")[0].inputs.width === 1296 && nodes(wf, "ImageScale")[0].inputs.height === 816, "…starting from the uploaded picture, scaled to about a megapixel (96 × 60 → 1296 × 816)");
  let log = (await jobs())[0];
  ok(nodes(wf, "KSampler")[0].inputs.denoise === 1, "…at full strength the sampler's denoise is 1");
  ok(log.instruction === "remove the logo on his shirt" && log.edit_model === "qwen-image-edit" && log.denoise === null && log.source === "comfy:StoryTime_1_0.png", "the job log keeps the instruction, the model and the source, with no strength (full strength isn't recorded)");
  ok(log.width === 1296 && log.height === 816 && log.checkpoint === "qwen_image_edit_2509_fp8_e4m3fn.safetensors" && log.prompt === "a smith at the forge" && log.negative === "", "…the edit's size and model file, and the prompt beside it");
  const panel = await page.locator(".chapter-pictures").innerText();
  ok(await page.getByRole("list", { name: "Pictures from “Edit: remove the logo on his shirt”" }).count() === 1 && panel.includes("Qwen-Image-Edit · 1296 × 816"), "the new picture's run says it is an edit, and its caption which model made it");
  await choose(items.first(), "Info");
  const info = page.getByRole("dialog", { name: "Picture info" });
  await info.waitFor();
  const infoText = await info.innerText();
  ok(infoText.includes("Edit instruction") && infoText.includes("remove the logo on his shirt") && infoText.includes("Qwen-Image-Edit (qwen_image_edit_2509_fp8_e4m3fn.safetensors)"), "Info shows the instruction and the edit model with its file");
  ok(await info.getByRole("button", { name: "Redraw from this" }).isVisible() && await info.getByRole("button", { name: "Edit this" }).isEnabled(), "…and offers Redraw from this and Edit this");
  await info.getByRole("button", { name: "Close" }).click();

  // ---- the other model ----
  await modelMenu.selectOption("flux-kontext");
  await until(async () => (await call("GET", "/api/settings")).settings.comfy.editModel === "flux-kontext", "the model choice to be saved");
  ok(true, "choosing another edit model saves it in the settings");
  await strength.fill("0.6");
  mark = comfy.calls.length;
  await makeEdit.click();
  await until(async () => (await items.count()) === 3 && (await ready()), "the Kontext edit");
  wf = prompts(mark)[0];
  ok(nodes(wf, "KSampler")[0].inputs.denoise === 0.6 && (await jobs())[0].denoise === 0.6, "a lower Strength is the edit's sampler denoise, and the log keeps it");
  ok((await page.locator(".chapter-pictures").innerText()).includes("strength 0.6"), "…and the picture's caption says so");
  ok(nodes(wf, "ReferenceLatent").length === 1 && nodes(wf, "DualCLIPLoader")[0].inputs.clip_name2 === "t5xxl_fp8_e4m3fn_scaled.safetensors" && nodes(wf, "CLIPTextEncode")[0].inputs.text === "remove the logo on his shirt", "with FLUX.1 Kontext, its workflow is queued with its files and the instruction");
  ok((await jobs())[0].edit_model === "flux-kontext", "…and the log says so");

  // ---- editing an edit, and redrawing ----
  await choose(items.first(), "Edit this");
  await until(async () => (await thumb.getAttribute("src")) !== startSrc, "the edit to become the starting picture");
  ok(await editTab.getAttribute("aria-selected") === "true" && await instruction.inputValue() === "remove the logo on his shirt", "Edit this on an edit makes it the starting picture, still on the Edit tab");
  await instruction.fill("add more smoke around him");
  mark = comfy.calls.length;
  await makeEdit.click();
  await until(async () => (await items.count()) === 4 && (await ready()), "the second edit");
  ok((await jobs())[0].instruction === "add more smoke around him" && (await jobs())[0].source === "comfy:StoryTime_3_0.png", "…so edits can follow one another");
  await choose(items.first(), "Redraw from this");
  ok(await redrawTab.getAttribute("aria-selected") === "true" && await strength.isVisible(), "Redraw from this chooses the Redraw tab");

  // ---- a saved picture ----
  await choose(items.first(), "Use as header picture");
  await page.getByText("Saved as the header picture.").waitFor();
  const header = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Header picture" }) });
  await header.locator("img.image-editor-preview").waitFor();
  await header.getByRole("button", { name: "More" }).click();
  await header.getByRole("menuitem", { name: "Edit this" }).click();
  await until(async () => ((await thumb.getAttribute("src")) ?? "").includes(`/api/chapters/${chapterId}/images/header`), "the header to become the starting picture");
  ok(await editTab.getAttribute("aria-selected") === "true", "the saved header's Edit this starts from it on the Edit tab");

  // ---- Qwen's Lightning LoRA ----
  const fastBox = page.getByRole("checkbox", { name: /^Fast/ });
  ok(await fastBox.count() === 0, "without the Lightning LoRA there is no Fast box");
  comfy.setMode({ files: { ...EDIT_FILES, loras: [LIGHTNING_LORA] } });
  await page.reload();
  await showAll();
  await choose(items.first(), "Edit this");
  await thumb.waitFor();
  await modelMenu.selectOption("qwen-image-edit");
  await fastBox.waitFor();
  ok(await fastBox.isChecked() && (await fastBox.locator("..").innerText()).includes("Fast (Lightning, 4 steps)"), "with the LoRA installed, Qwen has a Fast box, on, saying its steps");
  await modelMenu.selectOption("flux-kontext");
  ok(await fastBox.count() === 0, "…which Kontext doesn't have");
  await modelMenu.selectOption("qwen-image-edit");
  await instruction.fill("make it night");
  mark = comfy.calls.length;
  let before = await items.count();
  await makeEdit.click();
  await until(async () => (await items.count()) === before + 1 && (await ready()), "the fast edit");
  wf = prompts(mark)[0];
  const loraNode = nodes(wf, "LoraLoaderModelOnly")[0];
  ok(loraNode?.inputs.lora_name === LIGHTNING_LORA && nodes(wf, "KSampler")[0].inputs.steps === 4 && nodes(wf, "KSampler")[0].inputs.cfg === 1, "a fast edit loads the LoRA and runs 4 steps at CFG 1");
  log = (await jobs())[0];
  ok(log.checkpoint === `qwen_image_edit_2509_fp8_e4m3fn.safetensors + ${LIGHTNING_LORA}`, "…the job log keeps both files");
  ok((await page.locator(".chapter-pictures").innerText()).includes("Qwen-Image-Edit · fast · 1296 × 816"), "…and its caption says it was fast");
  await fastBox.uncheck();
  await until(async () => (await call("GET", "/api/settings")).settings.comfy.editFast === false, "the Fast box to be saved");
  ok(true, "turning Fast off is saved in the settings");
  mark = comfy.calls.length;
  before = await items.count();
  await makeEdit.click();
  await until(async () => (await items.count()) === before + 1 && (await ready()), "the slow edit");
  wf = prompts(mark)[0];
  ok(nodes(wf, "LoraLoaderModelOnly").length === 0 && nodes(wf, "KSampler")[0].inputs.steps === 20, "with Fast off, the edit runs the 20 steps without the LoRA");
  ok((await jobs())[0].checkpoint === "qwen_image_edit_2509_fp8_e4m3fn.safetensors", "…and the log keeps only the model's file");
  await fastBox.check();
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.waitForTimeout(300);
    await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-edit-fast-1000.png` });
  }

  // ---- an old ComfyUI ----
  comfy.setMode({ missingNodes: ["TextEncodeQwenImageEditPlus"] });
  await page.reload();
  await showAll();
  await choose(items.first(), "Edit this");
  await thumb.waitFor();
  ok((await modelMenu.locator("option").allInnerTexts()).join("|") === "FLUX.1 Kontext", "a model whose node ComfyUI lacks isn't offered");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await instruction.fill("remove the logo on his shirt");
    await page.waitForTimeout(300);
    await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-edit-1000.png` });
    await items.first().getByRole("button", { name: "More" }).click();
    await page.locator(".chapter-pictures .picture-tile").first().screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-edit-menu-1000.png` });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(300);
    await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-edit-390.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the Illustrate page does not scroll sideways");
    comfy.setMode({ missingNodes: [], files: { ...EDIT_FILES, diffusion_models: ["qwen_image_edit_2509_fp8_e4m3fn.safetensors"] } });
    await page.goto(`${BASE}/settings`);
    await page.getByRole("button", { name: "Check setup" }).click();
    await report.waitFor();
    await page.locator("#pictures").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-check-390.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the Settings check does not scroll sideways");
    await page.setViewportSize({ width: 1000, height: 1300 });
    await page.waitForTimeout(300);
    await page.locator("#pictures").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-check-1000.png` });
  }
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
