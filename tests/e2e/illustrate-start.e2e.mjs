// The starting picture of the Illustrate page's Instruct panel: "Instruct changes" on a new picture, a saved header
// and a past picture, the Strength slider, the starting picture uploaded to (the fake) ComfyUI, the workflow that is
// queued, what the job log keeps, Stop editing, and the errors. The fake ComfyUI refuses a LoadImage for a picture
// that wasn't uploaded. (Redrawing a picture, and painting an area, are on the Refine screen: refine-*.e2e.mjs.)
import { comfySettings, launch } from "./browser.mjs";
import { EDIT_FILES, startFakeComfy } from "./fakeComfy.mjs";

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
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100, files: EDIT_FILES });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const makeButton = page.getByRole("button", { name: "Queue", exact: true });
const items = page.locator(".candidates li.picture-tile");
const thumb = page.getByRole("img", { name: "Starting picture" });
const strength = page.getByRole("slider", { name: "Strength" });
const instruction = page.getByRole("textbox", { name: "What to change" });
const sizeMenu = page.getByLabel("Size", { exact: true });
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const uploads = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/upload/image");
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;
// No job is still being made (each running job shows its progress as a status).
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
// Two quick clicks with no starting picture: one job of two pictures.
const makeTwo = async () => {
  await makeButton.click();
  await makeButton.click();
};
// One click: one picture, once the picture count reaches `total`.
const make = async (total) => {
  await makeButton.click();
  await until(async () => (await items.count()) === total && (await ready()), `${total} pictures`, 150);
};
const settingsNow = async () => (await call("GET", "/api/settings")).settings.comfy;

try {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");
  await page.getByRole("textbox", { name: "Negative prompt", exact: true }).fill("blurry");

  // Instruct changes is in a picture's ☰ menu (once ComfyUI has said it has an edit model).
  const startFrom = async (tile, item = "Instruct changes") => {
    await tile.getByRole("button", { name: "More" }).click();
    const entry = tile.getByRole("menuitem", { name: item });
    await until(async () => (await entry.getAttribute("aria-disabled")) === null, `${item} to be offered`);
    await entry.click();
  };

  // ---- plain pictures first ----
  ok(await thumb.count() === 0 && await strength.count() === 0, "with nothing chosen there is no starting picture and no Strength slider");
  ok(await page.locator(".edit-panel.edit-collapsed").count() === 1 && await page.locator(".edit-panel").getByRole("heading", { name: "Instruct" }).isVisible() && await page.getByRole("tab").count() === 0, "the Instruct section is collapsed (heading only, no Redraw or Instruct tabs) while there is no picture");
  await makeTwo();
  await until(async () => (await items.count()) === 2 && (await ready()), "2 pictures", 150);
  ok(prompts().length === 1 && nodes(prompts()[0], "EmptyLatentImage").length === 1 && nodes(prompts()[0], "LoadImage").length === 0 && uploads().length === 0, "pictures made with no starting picture use the empty latent image and upload nothing");

  // ---- start from a new picture ----
  await startFrom(items.first());
  await thumb.waitFor();
  await instruction.waitFor();
  ok(await strength.isVisible() && await strength.inputValue() === "1", "Instruct changes shows the picture and a Strength slider at full strength");
  ok(await page.getByText("Low stays close to the picture").count() === 0 && await page.locator(".strength-ends").innerText() === "Low\nHigh", "…with its ends labelled Low and High instead of a line of explanation");
  ok(await sizeMenu.isDisabled(), "…and the Size menu is off, as the size comes from the picture");
  const clickedSrc = await items.first().locator("img").getAttribute("src");
  ok(await thumb.getAttribute("src") === clickedSrc, "…and the thumbnail is the picture that was chosen");
  ok(await items.first().getByText("Editing", { exact: true }).isVisible() && await page.locator(".picture-tile.editing").count() === 1, "…and that picture in the list is tagged Editing");
  // The layout can still be settling (pictures loading) right after the click, so look until it has.
  let arranged = false;
  for (let i = 0; i < 30 && !arranged; i++) {
    const thumbBox = await thumb.boundingBox();
    const stopBox = await page.getByRole("button", { name: "Stop editing" }).boundingBox();
    const strengthBox = await strength.boundingBox();
    arranged = !!(thumbBox && stopBox && strengthBox) && thumbBox.y + thumbBox.height <= strengthBox.y && stopBox.y > strengthBox.y;
    if (!arranged) await new Promise((r) => setTimeout(r, 100));
  }
  ok(arranged, "…and the picture is above the settings, with Stop editing at the bottom of the section");
  ok(await page.getByText(/The prompt above isn't used/).count() === 0 && await page.getByRole("button", { name: "Paint area" }).count() === 0 && await page.getByRole("textbox", { name: "Redraw prompt (optional)" }).count() === 0, "…without the long note about the prompt, and with nothing of the old Redraw (no Paint area, no Redraw prompt)");
  ok(await makeButton.isDisabled(), "Queue waits for an instruction");

  await instruction.fill("add a red scarf");
  await strength.fill("0.3");
  const mark = comfy.calls.length;
  await make(3);
  ok(uploads(mark).length === 1, "making a picture uploads the starting picture to ComfyUI once");
  const wf = prompts(mark)[0];
  const load = nodes(wf, "LoadImage")[0];
  ok(load && /^storytime-start-.*\.png$/.test(load.inputs.image), `the workflow loads the uploaded picture (${load?.inputs.image})`);
  ok(nodes(wf, "KSampler")[0].inputs.denoise === 0.3 && nodes(wf, "EmptyLatentImage").length === 0 && nodes(wf, "TextEncodeQwenImageEditPlus").some((n) => n.inputs.prompt === "add a red scarf"), "…at the chosen strength, with the instruction and no empty latent image");
  const log = await jobs();
  ok(log[0].denoise === 0.3 && log[0].source === "comfy:StoryTime_1_0.png" && log[0].instruction === "add a red scarf", `the job log keeps the strength, the source and the instruction (${log[0].denoise}, ${log[0].source})`);
  ok(log[1].denoise === null && log[1].source === null, "…and the plain job before it has neither");

  // ---- the same picture again is not sent again ----
  const again = comfy.calls.length;
  await make(4);
  ok(uploads(again).length === 0 && nodes(prompts(again)[0], "LoadImage")[0].inputs.image === load.inputs.image, "Making another from the same picture reuses the upload");

  // ---- from a saved picture ----
  await items.nth(2).getByRole("button", { name: "More" }).click();
  await items.nth(2).getByRole("menuitem", { name: "Use as header picture" }).click();
  await page.getByText("Saved as the header picture.").waitFor();
  const header = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Header picture" }) });
  await header.locator("img.image-editor-preview").waitFor();
  await startFrom(header);
  await until(async () => ((await thumb.getAttribute("src")) ?? "").includes(`/api/chapters/${chapterId}/images/header`), "the thumbnail to be the saved header");
  ok(true, "Instruct changes on the saved header makes it the starting picture");
  const savedMark = comfy.calls.length;
  // two jobs from it share one upload
  await make(5);
  await make(6);
  ok(uploads(savedMark).length === 1 && prompts(savedMark).length === 2 && (await jobs())[0].source === `saved:${chapterId}:header`, "…two jobs from it upload it once, and the log says it came from the saved header");
  const footerCard = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Footer picture" }) });
  await footerCard.getByRole("button", { name: "More" }).click();
  ok(await footerCard.getByRole("menuitem", { name: "Upload picture" }).count() === 1 && await footerCard.getByRole("menuitem", { name: "Instruct changes" }).count() === 0, "an empty slot has no Instruct changes");
  await page.keyboard.press("Escape");

  // ---- clear ----
  await page.getByRole("button", { name: "Stop editing" }).click();
  ok(await thumb.count() === 0 && await strength.count() === 0 && await sizeMenu.isEnabled(), "Stop editing removes it and the Size menu works again");
  ok(await page.locator(".edit-panel.edit-collapsed").count() === 1, "…and the Instruct section is collapsed again");
  const clearMark = comfy.calls.length;
  await makeTwo();
  await until(() => prompts(clearMark).length === 1, "a job");
  ok(nodes(prompts(clearMark)[0], "EmptyLatentImage").length === 1 && nodes(prompts(clearMark)[0], "LoadImage").length === 0, "pictures made afterwards are from the prompt alone again");
  await until(async () => (await items.count()) === 8 && (await ready()), "eight pictures", 150);

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
  await startFrom(pastTiles.nth(1));
  await thumb.waitFor();
  ok(((await thumb.getAttribute("src")) ?? "").includes("/view?"), "Instruct changes on a past picture makes it the starting picture");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Pinned & new/ }).click();
  ok(await page.locator(".picture-tile.editing").count() === 1, "a past picture being edited shows in Pinned & new, tagged Editing, though it isn't pinned");

  // ---- errors ----
  comfy.setMode({ fail: "upload" });
  const failMark = comfy.calls.length;
  await instruction.fill("add a red scarf");
  await makeButton.click();
  await page.getByText(/ComfyUI wouldn't take the starting picture/).waitFor();
  ok(prompts(failMark).length === 0 && await makeButton.isEnabled(), "when ComfyUI won't take the picture, the page says so, queues nothing and is ready again");
  comfy.setMode({ fail: null });

  // ---- a drawing preset's workflow that can't start from a picture doesn't matter to Instruct ----
  const noStart = JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } }, "2": { class_type: "KSampler", inputs: { seed: "{{seed}}", positive: ["1", 0] } }, "9": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "StoryTime" } } });
  const now = await settingsNow();
  await putSettings({ ...(await call("GET", "/api/settings")).settings, comfy: { ...now, drawPresets: now.drawPresets.map((p) => ({ ...p, workflow: noStart })) } });
  await page.reload();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");
  await showAll();
  await startFrom(pastTiles.first());
  await thumb.waitFor();
  await instruction.fill("add a red scarf");
  const okMark = comfy.calls.length;
  await makeButton.click();
  await until(() => prompts(okMark).length === 1, "the edit to be sent");
  ok(nodes(prompts(okMark)[0], "LoadImage").length === 1, "an edit is sent whatever the drawing preset's workflow can do (it uses the edit model's own workflow)");
  await until(async () => await ready(), "the edit to finish", 150);

  // ---- Settings says whether the workflow can ----
  await page.goto(`${BASE}/settings#preset-test`);
  const presetCard = page.locator("#preset-test");
  await presetCard.waitFor();
  await page.getByText("It can't start from a picture.").waitFor();
  ok(true, "Settings says that preset's workflow can't start from a picture");
  await presetCard.getByLabel("Workflow", { exact: true }).fill("");
  await page.getByText(/It can also start from a picture\./).waitFor();
  ok(true, "…and that the built-in workflow can");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.goto(`${BASE}/c/${chapterId}/illustrate`);
    await showAll();
    await startFrom(pastTiles.nth(1));
    await thumb.waitFor();
    await page.waitForTimeout(400);
    await page.locator(".edit-panel").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-start-1000.png` });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(300);
    await page.locator(".edit-panel").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-start-390.png` });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
  }
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
