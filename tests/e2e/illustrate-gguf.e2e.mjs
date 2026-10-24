// GGUF edit models (ComfyUI-GGUF's loaders) and the text encoder's device: Settings marks .gguf files and
// says when the GGUF nodes aren't installed; an edit preset with a .gguf model queues a workflow that
// loads it with UnetLoaderGGUF, and with "Keep the text encoder on the CPU" its loader gets device cpu.
// The fake ComfyUI has the GGUF nodes only when started with `gguf: true`.
import { comfySettings, launch } from "./browser.mjs";
import { EDIT_FILES, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3560;
const GGUF = "Qwen-Image-Edit-2509-Q4_K_S.gguf";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Quants", chapter: { title: "The forge", body: "The smith wore a shirt with a logo.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const files = { ...EDIT_FILES, diffusion_models: [...EDIT_FILES.diffusion_models, GGUF] };
// Without ComfyUI-GGUF first.
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100, files });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const presetNow = async () => (await call("GET", "/api/settings")).settings.comfy.editPresets.find((p) => p.id === "qwen-image-edit");

try {
  // ---- Settings without the GGUF nodes ----
  await page.goto(`${BASE}/settings#edit-qwen-image-edit`);
  const panel = page.locator("#panel-edit-qwen-image-edit");
  const card = page.locator("#preset-qwen-image-edit");
  const report = panel.locator(".comfy-check");
  await panel.getByRole("button", { name: "Check setup" }).click();
  await report.waitFor();
  ok((await report.innerText()).includes("GGUF files: install the ComfyUI-GGUF custom nodes to use them."), "without the GGUF nodes, the setup check says to install ComfyUI-GGUF");
  ok((await report.innerText()).includes("Qwen-Image-Edit: ready"), "…and that isn't an error: the model is still ready");

  // ---- with them ----
  comfy.setMode({ gguf: true });
  await panel.getByRole("button", { name: "Check setup" }).click();
  await until(async () => !(await report.innerText()).includes("GGUF files:"), "the check with the GGUF nodes");
  ok(true, "with the GGUF nodes, the line goes");
  await card.locator("details.advanced", { hasText: "Model files" }).locator("summary").click();
  const modelMenu = card.getByLabel("Model for Default");
  await until(async () => (await modelMenu.locator("option", { hasText: GGUF }).count()) === 1, "the GGUF file to be listed");
  ok((await modelMenu.locator("option", { hasText: GGUF }).innerText()) === `${GGUF} (GGUF)`, "a .gguf file is marked (GGUF) in the Model menu");
  ok((await modelMenu.locator("option", { hasText: "(none found)" }).count()) === 0 && (await modelMenu.locator("option").first().innerText()).includes("qwen_image_edit_2509_fp8_e4m3fn.safetensors"), "…and the safetensors file is still the one found by name");
  await modelMenu.selectOption(`model:${GGUF}`);
  const cpu = card.getByRole("checkbox", { name: "Text encoder on the CPU for Default" });
  ok(await cpu.isEnabled() && !(await cpu.isChecked()), "the text encoder starts on the default device");
  await cpu.check();
  ok(await until(async () => (await presetNow()).files.model === GGUF && (await presetNow()).textEncoderDevice === "cpu", "the preset to be saved"), "the preset keeps the .gguf model and the CPU choice");

  // ---- Instruct changes ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a smith at the forge");
  const queue = page.getByRole("button", { name: "Queue", exact: true });
  await queue.click();
  const items = page.locator(".candidates li.picture-tile");
  await until(async () => (await items.count()) === 1 && (await page.locator(".comfy-pending-tile [role=status]").count()) === 0, "a picture");
  await items.first().getByRole("button", { name: "More" }).click();
  const edit = items.first().getByRole("menu").getByRole("menuitem", { name: "Instruct changes" });
  await until(async () => (await edit.getAttribute("aria-disabled")) === null, "Instruct changes to be offered");
  await edit.click();
  await page.getByRole("textbox", { name: "What to change" }).fill("remove the logo on his shirt");
  const mark = comfy.calls.length;
  await queue.click();
  await until(async () => prompts(mark).length === 1, "the edit to be queued");
  const wf = prompts(mark)[0];
  ok(nodes(wf, "UnetLoaderGGUF")[0]?.inputs.unet_name === GGUF && nodes(wf, "UNETLoader").length === 0, "an edit with a .gguf model is queued with UnetLoaderGGUF");
  ok(!("weight_dtype" in nodes(wf, "UnetLoaderGGUF")[0].inputs), "…without the inputs that loader doesn't list");
  ok(nodes(wf, "CLIPLoader")[0]?.inputs.device === "cpu" && nodes(wf, "CLIPLoader")[0].inputs.type === "qwen_image", "…and the text encoder loader has device cpu");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
