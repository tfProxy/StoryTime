// The newer drawing models (Z-Image, Flux…): a drawing preset's Model type in Settings, its model, text encoder
// and VAE choosers (with a .gguf model), the setup check, and the workflow a picture is queued with. Against the
// fake ComfyUI (with the ComfyUI-GGUF nodes when `gguf: true`).
import { comfySettings, launch } from "./browser.mjs";
import { FAMILY_FILES, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3560;
const ZGGUF = "z_image_turbo-Q8_0.gguf";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Families", chapter: { title: "The fox", body: "A fox crossed the frozen river.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const files = { ...FAMILY_FILES, diffusion_models: [...FAMILY_FILES.diffusion_models, ZGGUF, "qwen_image_edit_2509_fp8_e4m3fn.safetensors"] };
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100, files, gguf: true });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const presetNow = async () => (await call("GET", "/api/settings")).settings.comfy.drawPresets.find((p) => p.id === "test");
const items = page.locator(".candidates li.picture-tile");
const queue = page.getByRole("button", { name: "Queue", exact: true });

try {
  // ---- Settings: choose the model type ----
  await page.goto(`${BASE}/settings#preset-test`);
  const panel = page.locator("#panel-drawing");
  const card = page.locator("#preset-test");
  const report = panel.locator(".comfy-check");
  const type = card.getByLabel("Model type", { exact: true });
  await type.waitFor();
  const typeOptions = await type.locator("option").evaluateAll((os) => os.map((o) => o.textContent));
  ok(typeOptions.join("|").startsWith("Checkpoint (SDXL, Pony, Illustrious, SD 1.5)|Z-Image"), `the Model type menu offers Checkpoint, then the model families (${typeOptions.join("|")})`);
  ok(await type.inputValue() === "checkpoint" && (await card.getByLabel("Checkpoint", { exact: true }).count()) === 1 && (await card.getByLabel("Model file").count()) === 0, "a preset starts on Checkpoint, with the checkpoint chooser");
  await card.getByLabel("Preset prompt", { exact: true }).fill("a storybook illustration");
  await type.selectOption("zimage");
  ok((await card.getByLabel("Checkpoint", { exact: true }).count()) === 0 && (await card.getByLabel("Model file").count()) === 1, "choosing Z-Image replaces the Checkpoint chooser with Model / Text encoder / VAE");
  ok((await card.innerText()).includes("puts the sampler settings back to the new type's defaults and clears the chosen model files"), "…and says that the sampler settings and chosen files go back to the defaults");
  await until(async () => (await presetNow()).family === "zimage", "the family to be saved");
  const saved = await presetNow();
  ok(saved.promptStyle === "natural" && Object.keys(saved.sampler).length === 0 && saved.prompt === "a storybook illustration", "…the prompt style becomes sentences, the sampler overrides are cleared and the rest is kept");

  const modelMenu = card.getByLabel("Model file");
  await until(async () => (await modelMenu.locator("option", { hasText: ZGGUF }).count()) === 1, "the models to be listed");
  ok((await modelMenu.locator("option", { hasText: ZGGUF }).innerText()) === `${ZGGUF} (GGUF)`, "a .gguf model is marked (GGUF)");
  ok((await modelMenu.locator("option").first().innerText()).includes("z_image_turbo_bf16.safetensors"), "…and the first choice says which file is found by its name");
  ok((await card.getByLabel("Qwen 3 4B text encoder").locator("option").first().innerText()).includes("qwen_3_4b.safetensors") && (await card.getByLabel("FLUX VAE").locator("option").first().innerText()).includes("ae.safetensors"), "the text encoder and VAE choosers say what they would use");
  await modelMenu.selectOption(ZGGUF);
  await card.getByRole("checkbox", { name: "Text encoder on the CPU for Test drawing" }).check();
  await card.locator("details.advanced", { hasText: "Advanced" }).locator("summary").first().click();
  ok((await card.locator(".tuning").first().innerText()).includes("default 9"), "the Advanced settings start from Z-Image's defaults (9 steps)");
  ok(await until(async () => (await presetNow()).files.model === ZGGUF && (await presetNow()).textEncoderDevice === "cpu", "the choices to be saved"), "the preset keeps the .gguf model and the CPU choice");
  ok((await card.locator("summary").first().innerText()).includes("Z-Image · z_image_turbo-Q8_0"), "the card's summary names the family and the model file");

  // ---- the setup check ----
  await panel.getByRole("button", { name: "Check setup" }).click();
  await report.waitFor();
  let text = await report.innerText();
  ok(text.includes("Z-Image: ready") && text.includes(ZGGUF) && text.includes("qwen_3_4b.safetensors") && text.includes("ae.safetensors"), "the setup check says the Z-Image preset is ready, with its files");
  ok(!text.includes("No checkpoints") && !text.includes("checkpoint in models/checkpoints"), "…and doesn't ask for a checkpoint");
  comfy.setMode({ gguf: false });
  await panel.getByRole("button", { name: "Check setup" }).click();
  await until(async () => (await report.innerText()).includes("ComfyUI-GGUF"), "the check without the GGUF nodes");
  text = await report.innerText();
  ok(text.includes("install the ComfyUI-GGUF custom nodes") && text.includes("Z-Image: not ready"), "without ComfyUI-GGUF, a chosen .gguf file makes the check say to install it");
  comfy.setMode({ gguf: true });

  // ---- a picture ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a fox on the ice");
  const mark = comfy.calls.length;
  await queue.click();
  await until(async () => prompts(mark).length === 1, "the picture to be queued");
  await until(async () => (await items.count()) === 1 && (await page.locator(".comfy-pending-tile [role=status]").count()) === 0, "the picture");
  const wf = prompts(mark)[0];
  ok(nodes(wf, "UnetLoaderGGUF")[0]?.inputs.unet_name === ZGGUF && nodes(wf, "UNETLoader").length === 0, "the picture is queued with UnetLoaderGGUF for the .gguf model");
  const clip = nodes(wf, "CLIPLoader")[0];
  ok(clip?.inputs.type === "lumina2" && clip.inputs.device === "cpu" && clip.inputs.clip_name === "qwen_3_4b.safetensors", "…a lumina2 CLIPLoader on the CPU");
  ok(nodes(wf, "VAELoader")[0]?.inputs.vae_name === "ae.safetensors" && nodes(wf, "EmptySD3LatentImage").length === 1 && nodes(wf, "CheckpointLoaderSimple").length === 0, "…the Flux VAE and an SD3 latent, no checkpoint");
  const ks = nodes(wf, "KSampler")[0];
  ok(ks.inputs.steps === 9 && ks.inputs.cfg === 1 && ks.inputs.sampler_name === "res_multistep", "…and Z-Image's sampler settings");
  ok(nodes(wf, "CLIPTextEncode")[0].inputs.text.includes("a fox on the ice") && nodes(wf, "CLIPTextEncode")[0].inputs.text.includes("a storybook illustration"), "…with the preset's prompt added to the prompt");
  const job = (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs[0];
  ok(job?.checkpoint === ZGGUF, `the job log records the model file (${job?.checkpoint})`);
  await items.first().getByRole("button", { name: "More" }).click();
  await items.first().getByRole("menu").getByRole("menuitem", { name: "Info" }).click();
  ok((await page.getByRole("dialog").innerText()).includes(ZGGUF), "Info shows the model file");
  await page.keyboard.press("Escape");

  // ---- Redraw from a picture ----
  await items.first().getByRole("button", { name: "More" }).click();
  await items.first().getByRole("menuitem", { name: "Redraw from this" }).click();
  await page.getByRole("slider", { name: "Strength" }).waitFor();
  const mark2 = comfy.calls.length;
  await queue.click();
  await until(async () => prompts(mark2).length === 1, "the redraw to be queued");
  const redraw = prompts(mark2)[0];
  ok(nodes(redraw, "LoadImage").length === 1 && nodes(redraw, "ImageScale").length === 1 && nodes(redraw, "VAEEncode").length === 1 && nodes(redraw, "RepeatLatentBatch").length === 1 && nodes(redraw, "EmptySD3LatentImage").length === 0, "Redraw starts from the picture: LoadImage, ImageScale, VAEEncode, RepeatLatentBatch");
  ok(nodes(redraw, "KSampler")[0].inputs.denoise === 0.55, "…at the preset's Redraw strength");

  // ---- Flux ----
  const chooseType = async (family) => {
    await page.goto(`${BASE}/settings#preset-test`);
    await page.locator("#preset-test").getByLabel("Model type", { exact: true }).selectOption(family);
    await until(async () => (await presetNow()).family === family, `the ${family} type to be saved`);
  };
  /** Opens the Illustrate page afresh (so ComfyUI is asked again), queues one picture and returns its workflow. */
  const draw = async (text) => {
    await page.goto(`${BASE}/c/${chapterId}/illustrate`);
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(text);
    const mark = comfy.calls.length;
    await queue.click();
    await until(async () => prompts(mark).length === 1, "the picture to be queued");
    await until(async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0, "the picture to be made");
    return prompts(mark)[0];
  };
  await chooseType("flux");
  const flux = await presetNow();
  ok(Object.keys(flux.files).length === 0 && Object.keys(flux.sampler).length === 0 && flux.promptStyle === "natural", "changing the type to Flux clears the chosen files (a Z-Image model isn't a Flux one) and the sampler overrides");
  const fluxCard = page.locator("#preset-test");
  await fluxCard.locator("details.advanced", { hasText: "Advanced" }).locator("summary").first().click();
  ok((await fluxCard.locator(".tuning").first().innerText()).includes("Guidance") && (await fluxCard.locator(".tuning").first().innerText()).includes("default 3.5"), "Flux's Advanced settings have Guidance (default 3.5)");
  ok((await fluxCard.getByLabel("T5-XXL text encoder").locator("option").first().innerText()).includes("t5xxl_fp8_e4m3fn_scaled.safetensors") && (await fluxCard.getByLabel("CLIP-L text encoder").count()) === 1, "…and two text encoder choosers");
  const fluxWf = await draw("a fox on the ice, in sentences");
  const guidance = nodes(fluxWf, "FluxGuidance")[0];
  ok(guidance?.inputs.guidance === 3.5 && nodes(fluxWf, "DualCLIPLoader")[0]?.inputs.type === "flux" && nodes(fluxWf, "UNETLoader")[0]?.inputs.unet_name === "flux1-dev-fp8.safetensors", "a Flux picture is queued with UNETLoader, DualCLIPLoader (flux) and FluxGuidance 3.5");
  ok(nodes(fluxWf, "KSampler")[0].inputs.steps === 20 && nodes(fluxWf, "ConditioningZeroOut").length === 1, "…20 steps and a zeroed-out negative");
  ok((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs[0]?.checkpoint === "flux1-dev-fp8.safetensors", "…and the job log records the Flux model file");

  // ---- Chroma ----
  await chooseType("chroma");
  const chromaWf = await draw("a fox on the ice, again");
  ok(nodes(chromaWf, "CLIPLoader")[0]?.inputs.type === "chroma" && nodes(chromaWf, "CLIPTextEncode").length === 2 && nodes(chromaWf, "T5TokenizerOptions").length === 0, "a Chroma picture is queued with a chroma CLIPLoader and two prompts, and no T5TokenizerOptions ComfyUI lacks");
  ok(nodes(chromaWf, "KSampler")[0].inputs.cfg === 4 && nodes(chromaWf, "KSampler")[0].inputs.scheduler === "beta", "…at CFG 4 with the beta scheduler");
  comfy.setMode({ tokenizerOptions: true });
  const chromaTok = await draw("a fox on the ice, once more");
  ok(nodes(chromaTok, "T5TokenizerOptions").length === 1, "when ComfyUI has T5TokenizerOptions the workflow uses it");

  // ---- Qwen-Image (with the Qwen-Image-Edit model in the same folder) ----
  await chooseType("qwen-image");
  const qwenWf = await draw("a fox on the ice, with a sign saying HELLO");
  ok(nodes(qwenWf, "UNETLoader")[0]?.inputs.unet_name === "qwen_image_fp8_e4m3fn.safetensors", "a Qwen-Image picture uses the Qwen-Image model, not the Qwen-Image-Edit one beside it");
  ok(nodes(qwenWf, "CLIPLoader")[0]?.inputs.type === "qwen_image" && nodes(qwenWf, "ModelSamplingAuraFlow")[0]?.inputs.shift === 3.1 && nodes(qwenWf, "CLIPTextEncode").length === 2 && nodes(qwenWf, "KSampler")[0].inputs.cfg === 2.5, "…with a qwen_image text encoder, shift 3.1, two prompts and CFG 2.5");

  // ---- a preset whose files are missing says so and doesn't queue ----
  const now = (await call("GET", "/api/settings")).settings;
  await putSettings({ ...now, comfy: { ...now.comfy, drawPresets: [{ ...(await presetNow()), family: "chroma", files: { model: "deleted.safetensors" } }] } });
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  const markGone = comfy.calls.length;
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("never drawn");
  await until(async () => (await page.getByRole("button", { name: "Queue", exact: true }).isEnabled()), "Queue");
  await queue.click();
  await page.getByText("can't draw yet").waitFor();
  ok(prompts(markGone).length === 0 && (await page.getByText("can't draw yet").innerText()).includes("deleted.safetensors"), "a family preset whose model ComfyUI doesn't list doesn't queue, and the page says which file");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
