// Image to image on the Illustrate page: "Start from this" on a new picture, a saved header and a past picture,
// the Strength slider, the starting picture uploaded to (the fake) ComfyUI, the workflow that is queued, what the
// job log keeps, Clear, and the errors. The fake ComfyUI refuses a LoadImage for a picture that wasn't uploaded.
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3557;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Variations", chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100 });
const baseComfy = { url: comfy.url, workflow: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, count: 2, denoise: 0.55 };
await putSettings({ ...(before ?? {}), comfy: baseComfy });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const makeButton = page.getByRole("button", { name: /^(Make pictures|Queue more)$/ });
const items = page.locator(".candidates li");
const thumb = page.getByRole("img", { name: "Starting picture" });
const strength = page.getByRole("slider", { name: "Strength" });
const sizeMenu = page.getByLabel("Size", { exact: true });
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const uploads = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/upload/image");
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;
const make = async (total) => {
  await makeButton.click();
  await until(async () => (await items.count()) === total && (await ready()), `${total} pictures`, 150);
};
// No job is still being made (each running job shows its progress as a status).
const ready = async () => (await page.locator(".comfy-queue [role=status]").count()) === 0;
const settingsNow = async () => (await call("GET", "/api/settings")).settings.comfy;

try {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");
  await page.getByRole("textbox", { name: "Negative prompt", exact: true }).fill("blurry");

  // ---- plain pictures first ----
  ok(await thumb.count() === 0 && await strength.count() === 0, "with nothing chosen there is no starting picture and no Strength slider");
  await make(2);
  ok(prompts().length === 1 && nodes(prompts()[0], "EmptyLatentImage").length === 1 && nodes(prompts()[0], "LoadImage").length === 0 && uploads().length === 0, "pictures made with no starting picture use the empty latent image and upload nothing");

  // ---- start from a new picture ----
  await items.first().getByRole("button", { name: "Start from this" }).click();
  await thumb.waitFor();
  ok(await strength.isVisible() && await strength.inputValue() === "0.55", "Start from this shows the picture and a Strength slider at 0.55");
  ok(await page.getByText("Low keeps the picture close; high changes more.").isVisible(), "…with a line saying what Strength does");
  ok(await sizeMenu.isDisabled(), "…and the Size menu is off, as the size comes from the picture");
  const clickedSrc = await items.first().locator("img").getAttribute("src");
  ok(await thumb.getAttribute("src") === clickedSrc, "…and the thumbnail is the picture that was chosen");

  await strength.fill("0.3");
  ok(await until(async () => (await settingsNow()).denoise === 0.3, "the strength to be saved"), "moving the slider saves the strength in the settings");
  const mark = comfy.calls.length;
  await make(4);
  ok(uploads(mark).length === 1, "making pictures uploads the starting picture to ComfyUI once");
  const wf = prompts(mark)[0];
  const load = nodes(wf, "LoadImage")[0];
  ok(load && /^storytime-start-.*\.png$/.test(load.inputs.image), `the workflow loads the uploaded picture (${load?.inputs.image})`);
  ok(nodes(wf, "KSampler")[0].inputs.denoise === 0.3 && nodes(wf, "RepeatLatentBatch")[0].inputs.amount === 2 && nodes(wf, "EmptyLatentImage").length === 0, "…at the chosen strength, as a batch of 2, with no empty latent image");
  ok(nodes(wf, "VAEEncode").length === 1 && nodes(wf, "CLIPTextEncode").some((n) => n.inputs.text === "a keeper beside a lamp"), "…encoded by the VAE, with the prompt still set");
  const log = await jobs();
  ok(log[0].denoise === 0.3 && log[0].source === "comfy:StoryTime_1_0.png" && log[0].width === 96 && log[0].height === 60, `the job log keeps the strength, the source and the picture's own size (${log[0].denoise}, ${log[0].source}, ${log[0].width}x${log[0].height})`);
  ok(log[1].denoise === null && log[1].source === null, "…and the plain job before it has neither");

  // ---- the same picture again is not sent again ----
  const again = comfy.calls.length;
  await make(6);
  ok(uploads(again).length === 0 && nodes(prompts(again)[0], "LoadImage")[0].inputs.image === load.inputs.image, "Make more from the same picture reuses the upload");

  // ---- from a saved picture ----
  await items.first().getByRole("button", { name: "Use as header picture" }).click();
  await page.getByText("Saved as the header picture.").waitFor();
  const header = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Header picture" }) });
  await header.getByRole("button", { name: "Start from this" }).waitFor();
  await header.getByRole("button", { name: "Start from this" }).click();
  await until(async () => ((await thumb.getAttribute("src")) ?? "").includes(`/api/chapters/${chapterId}/images/header`), "the thumbnail to be the saved header");
  ok(true, "Start from this on the saved header makes it the starting picture");
  const savedMark = comfy.calls.length;
  // two jobs queued at once share one upload
  await makeButton.click();
  await make(10);
  ok(uploads(savedMark).length === 1 && prompts(savedMark).length === 2 && (await jobs())[0].source === `saved:${chapterId}:header`, "…two jobs queued at once from it upload it once, and the log says it came from the saved header");
  ok(await page.locator(".image-editor", { has: page.getByRole("heading", { name: "Footer picture" }) }).getByRole("button", { name: "Start from this" }).count() === 0, "an empty slot has no Start from this");

  // ---- clear ----
  await page.getByRole("button", { name: "Clear starting picture" }).click();
  ok(await thumb.count() === 0 && await strength.count() === 0 && await sizeMenu.isEnabled(), "Clear starting picture removes it and the Size menu works again");
  const clearMark = comfy.calls.length;
  await makeButton.click();
  await until(() => prompts(clearMark).length === 1, "a job");
  ok(nodes(prompts(clearMark)[0], "EmptyLatentImage").length === 1 && nodes(prompts(clearMark)[0], "LoadImage").length === 0, "pictures made afterwards are from the prompt alone again");
  await until(async () => (await items.count()) === 12 && (await ready()), "twelve pictures", 150);

  // ---- from a past picture ----
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  const pastTiles = page.locator(".chapter-pictures .picture-tile");
  // Earlier pictures are under All once the page is opened again.
  const showAll = async () => {
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
    await pastTiles.first().waitFor();
  };
  await showAll();
  ok((await page.locator(".chapter-pictures").innerText()).includes("strength 0.3"), "an earlier picture made from a picture says its strength");
  await pastTiles.nth(1).getByRole("button", { name: "Start from this" }).click();
  await thumb.waitFor();
  ok(((await thumb.getAttribute("src")) ?? "").includes("/view?"), "Start from this on a past picture makes it the starting picture");

  // ---- errors ----
  comfy.setMode({ fail: "upload" });
  const failMark = comfy.calls.length;
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");
  await makeButton.click();
  await page.getByText(/ComfyUI wouldn't take the starting picture/).waitFor();
  ok(prompts(failMark).length === 0 && await makeButton.isEnabled(), "when ComfyUI won't take the picture, the page says so, queues nothing and is ready again");
  comfy.setMode({ fail: null });

  await putSettings({ ...(await call("GET", "/api/settings")).settings, comfy: { ...(await settingsNow()), workflow: JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } }, "2": { class_type: "KSampler", inputs: { seed: "{{seed}}", positive: ["1", 0] } }, "9": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "StoryTime" } } }) } });
  await page.reload();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");
  await showAll();
  await pastTiles.first().getByRole("button", { name: "Start from this" }).click();
  await thumb.waitFor();
  const refusedMark = comfy.calls.length;
  await makeButton.click();
  await page.getByText(/Your workflow can't start from a picture/).waitFor();
  ok(prompts(refusedMark).length === 0, "a workflow that can't start from a picture says so, without being sent to ComfyUI");

  // ---- Settings says whether the workflow can ----
  await page.goto(`${BASE}/settings`);
  await page.locator("#pictures").waitFor();
  await page.getByText("It can't start from a picture.").waitFor();
  ok(true, "Settings says that workflow can't start from a picture");
  await page.locator("#pictures textarea").fill("");
  await page.getByText(/It can also start from a picture\./).waitFor();
  ok(true, "…and that the built-in workflow can");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.goto(`${BASE}/c/${chapterId}/illustrate`);
    await showAll();
    await pastTiles.nth(1).getByRole("button", { name: "Start from this" }).click();
    await thumb.waitFor();
    await page.waitForTimeout(400);
    await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-start-1000.png` });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(300);
    await page.locator(".comfy-generate").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-start-390.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
  }
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
