// Settings › Drawing: a checkpoint preset's Model base (which picks the IP-Adapter files for reference
// pictures), and the setup check's informational line about them. Against the fake ComfyUI, without and
// with the IP-Adapter nodes and files.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (url) => (await fetch(BASE + url)).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const before = (await call("/api/settings")).settings;
const NOOB = "noobaiXL_vpred10.safetensors";
const bare = await startFakeComfy({ port: 3574, checkpoints: [NOOB, "plain_sdxl.safetensors"] });
const full = await startFakeComfy({
  port: 3575, checkpoints: [NOOB, "plain_sdxl.safetensors"], ipAdapter: true,
  files: { ipadapter: ["noobIPAMARK1_mark1.safetensors"], clip_vision: ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"] },
});
const presets = [
  { id: "noob", name: "Noob", checkpoint: NOOB },
  { id: "flux", name: "Fluxy", family: "flux" },
];
const useComfy = (c) => putSettings({ ...(before ?? {}), comfy: { ...comfySettings({ url: c.url, count: 1 }), drawPresets: presets } });
await useComfy(bare);

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 400, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const settingsNow = async () => (await call("/api/settings")).settings.comfy;
const checkLines = async (name) => {
  await page.getByRole("button", { name: "Check setup" }).first().click();
  const block = page.locator(".comfy-check-model", { hasText: name });
  await block.waitFor();
  return block;
};

try {
  await page.goto(`${BASE}/settings#preset-noob`);
  const card = page.locator("#preset-noob");
  await card.waitFor();
  const base = card.getByLabel("Model base");
  const guess = await base.locator("option").first().innerText();
  ok(guess === "Guess from the file name (NoobAI)", `the first choice guesses from the file name: ${guess}`);
  ok((await base.locator("option").allInnerTexts()).slice(1).join() === "SDXL,Illustrious,NoobAI,Pony", "…then SDXL, Illustrious, NoobAI and Pony");
  ok((await card.innerText()).includes("picks the IP-Adapter files used for reference pictures"), "a hint says what it is for");
  await page.locator("#preset-flux > summary").click();
  ok((await page.locator("#preset-flux").getByLabel("Model base").count()) === 0, "a model-family preset has no Model base");

  // ---- the check, without IP-Adapter ----
  let block = await checkLines("Noob");
  let text = await block.innerText();
  ok(text.includes("Reference pictures (IP-Adapter): not set up") && text.includes("this preset draws fine without"), "without the nodes the line says it is not set up, and that it is optional");
  ok(text.includes("ComfyUI_IPAdapter_plus") && text.includes("ComfyUI-Manager"), "…and says to install ComfyUI_IPAdapter_plus through ComfyUI-Manager");
  ok(text.includes("noobIPAMARK1_mark1.safetensors") && text.includes("models/ipadapter") && text.includes("CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors") && text.includes("models/clip_vision"), "…and which file goes in which folder");
  ok(text.includes("Checkpoint:") && !(await block.locator("li.error").filter({ hasText: "IP-Adapter" }).count()), "the preset's other lines are fine, and the IP-Adapter one is not an error");
  ok(!(await page.locator(".comfy-check-model", { hasText: "Fluxy" }).innerText()).includes("IP-Adapter"), "a model-family preset has no IP-Adapter line");

  // ---- a chosen base is saved, and picks the files ----
  await useComfy(full);
  await page.reload(); // the page keeps the address it loaded, so only a reload sees the other ComfyUI
  await page.locator("#preset-noob > summary").waitFor();
  if (!(await card.evaluate((d) => d.open))) await page.locator("#preset-noob > summary").click();
  await card.waitFor();
  await base.selectOption("pony");
  ok(await until(async () => (await settingsNow()).drawPresets.find((p) => p.id === "noob")?.base === "pony", "the base to be saved"), "choosing Pony saves it in the preset");
  block = await checkLines("Noob");
  text = await block.innerText();
  ok(text.includes("not set up") && text.includes("ip-adapter-plus_sdxl_vit-h.safetensors") && !text.includes("ComfyUI_IPAdapter_plus"), "Pony wants the SDXL files, and the nodes are there");
  await base.selectOption("");
  ok(await until(async () => (await settingsNow()).drawPresets.find((p) => p.id === "noob")?.base === undefined, "the base to be cleared"), "going back to the guess clears it");
  block = await checkLines("Noob");
  ok((await block.innerText()).includes("Reference pictures (IP-Adapter): ready"), "guessed NoobAI, with its files installed: ready");
  ok(await block.locator("li.ok", { hasText: "IP-Adapter" }).count() === 1, "…shown as a tick");

  await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR ?? "/tmp"}/settings-ipadapter-400.png`, fullPage: true });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the Drawing tab does not scroll sideways");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await bare.close();
  await full.close();
}
process.exit(failed ? 1 : 0);
