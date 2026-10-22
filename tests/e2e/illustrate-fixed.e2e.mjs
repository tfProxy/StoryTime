// Text added to picture prompts: a drawing preset's prompt and negative prompt (shown under the boxes), and a
// chapter's "Always include" box. Against the fake ComfyUI.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3561;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Fixed", chapter: { title: "The harbour", body: "Boats rocked in the harbour.", choices: [] } });
const { chapter_id: chapterId } = story;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 50, startDelay: 80, checkpoints: ["fake_sdxl_a.safetensors"] });
const preset = { id: "q", name: "Quality", promptStyle: "tags", prompt: "masterpiece, best quality", negative: "lowres, watermark", checkpoint: "fake_sdxl_a.safetensors", workflow: "", loras: [], sampler: {}, denoise: 0.55 };
await putSettings({ ...(before ?? {}), comfy: { ...comfySettings({ url: comfy.url, count: 1 }), drawPresets: [preset] } });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const items = page.locator(".candidates li.picture-tile");
const queue = page.getByRole("button", { name: "Queue", exact: true });
const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
const negativeBox = page.getByRole("textbox", { name: "Negative prompt", exact: true });
const fixedBox = page.getByLabel("Always include (this chapter)");
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
/** Queues one picture and waits for it; returns the positive and negative text sent. */
const makeOne = async () => {
  const mark = comfy.calls.length;
  const n = await items.count();
  await queue.click();
  await until(async () => (await items.count()) === n + 1 && (await ready()), "the picture");
  const wf = prompts(mark)[0];
  const sampler = Object.values(wf).find((x) => x.class_type === "KSampler");
  return { positive: wf[sampler.inputs.positive[0]].inputs.text, negative: wf[sampler.inputs.negative[0]].inputs.text };
};

try {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await promptBox.fill("boats, Best_Quality, harbour");
  await negativeBox.fill("blurry");
  ok((await page.locator(".prompt-field").nth(0).innerText()).includes("Preset: masterpiece, best quality"), "the preset's prompt is shown under the Prompt box");
  ok((await page.locator(".prompt-field").nth(1).innerText()).includes("Preset: lowres, watermark"), "…and its negative prompt under the Negative prompt box");
  let sent = await makeOne();
  ok(sent.positive === "masterpiece, best quality, boats, harbour", "the preset's prompt goes first, without repeating a tag the prompt has");
  ok(sent.negative === "blurry, lowres, watermark", "the preset's negative prompt follows the negative prompt");

  await fixedBox.fill("1girl, red scarf");
  ok(await until(async () => (await call("GET", `/api/chapters/${chapterId}/picture-fixed`)).fixed === "1girl, red scarf", "the always-include text to be saved"), "the always-include text is kept for the chapter");
  await promptBox.fill("boats, Red_Scarf, harbour");
  sent = await makeOne();
  ok(sent.positive === "masterpiece, best quality, 1girl, red scarf, boats, harbour", "the always-include text follows the preset's, and a tag it shares with the prompt appears once");
  ok(await promptBox.inputValue() === "boats, Red_Scarf, harbour", "…and the prompt box itself is left as typed");

  await page.reload();
  ok(await fixedBox.inputValue() === "1girl, red scarf", "after a refresh the always-include text is still there");

  await page.setViewportSize({ width: 390, height: 900 });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
