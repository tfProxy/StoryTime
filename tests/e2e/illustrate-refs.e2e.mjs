// Reference pictures on the Illustrate and cover pages: the References section, the picker (Suggested, Pictures,
// Upload), Use as reference in a picture's ☰ menu, role and strength, the workflow sent with IP-Adapter, Info,
// keeping the references per chapter and moment, Load prompt, a preset that can't use them, and the cover page.
// Against the fake ComfyUI with the IP-Adapter nodes and files.
import fs from "node:fs";
import { comfySettings, launch } from "./browser.mjs";
import { makePng, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3580;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const putImage = (url, bytes) => fetch(BASE + url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: bytes });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const NOOB = "noobaiXL_vpred10.safetensors";
const created = await call("POST", "/api/stories", { title: "Refs saga", premise: "A keeper guards a lonely beacon.", chapter: { title: "The lamp", body: "Zephyr climbed the stairs.", choices: ["Go down"] } });
const { story_id: storyId, chapter_id: first } = created;
const choice = (await call("GET", `/api/chapters/${first}`)).choices[0];
const second = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "The cellar", body: "Water rose in the cellar.", choices: [] })).chapter_id;
// Saved pictures: the first chapter's header and footer, the second's header, and the cover.
await putImage(`/api/chapters/${first}/images/header`, makePng(0));
await putImage(`/api/chapters/${first}/images/footer`, makePng(1));
await putImage(`/api/chapters/${second}/images/header`, makePng(2));
await putImage(`/api/stories/${storyId}/cover`, makePng(3));

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({
  port: COMFY_PORT, steps: 2, stepDelay: 50, startDelay: 80, checkpoints: [NOOB], ipAdapter: true,
  files: { ipadapter: ["noobIPAMARK1_mark1.safetensors"], clip_vision: ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"] },
});
const noob = { id: "noob", name: "Noob", checkpoint: NOOB, workflow: "", loras: [], sampler: {}, denoise: 0.55 };
await putSettings({ ...(before ?? {}), comfy: { ...comfySettings({ url: comfy.url, count: 1 }), drawPresets: [noob, { id: "flux", name: "Fluxy", family: "flux" }] } });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1500 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const section = page.locator("#picture-references");
const rows = section.locator("li.reference-item");
const picker = page.getByRole("dialog", { name: "Add a reference" });
const moment = page.getByLabel("Moment to show");
const queue = page.getByRole("button", { name: "Queue", exact: true });
const tiles = page.locator("li.picture-tile");
const drawMenu = page.locator(".comfy-generate").getByLabel("Drawing preset");
const add = section.getByRole("button", { name: "Add reference" });
const jobs = async (chapter) => (await call("GET", `/api/picture-jobs?chapter=${chapter}`)).jobs;
const prompts = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.entries(wf).filter(([, n]) => n.class_type === type);
const draft = async (chapter) => (await call("GET", `/api/chapters/${chapter}/picture-draft`)).draft;
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;

try {
  // ---- the section, and a suggestion for the footer ----
  await page.goto(`${BASE}/c/${second}/illustrate`);
  await section.waitFor();
  ok((await section.innerText()).includes("Pictures to keep a character, item, place or style the same.") && (await rows.count()) === 0, "with no references the section says what they are for");
  await moment.selectOption("end");
  await add.click();
  await picker.waitFor();
  ok(await picker.getByRole("tab", { name: "Suggested" }).getAttribute("aria-selected") === "true", "Add reference opens the picker on Suggested");
  const suggested = await picker.locator("li button").allInnerTexts();
  ok(suggested.length === 1 && suggested[0].includes("Header") && suggested[0].includes("This chapter's header"), "making a footer, this chapter's header is suggested");
  await picker.getByRole("tab", { name: "Pictures" }).click();
  const offered = (await picker.locator("li button").allInnerTexts()).join("|");
  ok(offered.includes("Ch. The lamp footer") && offered.includes("Ch. The lamp header") && offered.includes("Cover"), "…and Pictures lists the headers and footers on the path, and the cover");
  await picker.getByRole("tab", { name: "Suggested" }).click();
  await picker.locator("li button").first().click();
  await picker.waitFor({ state: "detached" });
  ok((await rows.count()) === 1 && await rows.first().getByLabel("Label of reference 1").inputValue() === "Header", "choosing it adds it as “Header” and closes the picker");
  ok(await rows.first().getByLabel("Role of reference 1").inputValue() === "character" && await rows.first().getByLabel("Strength of reference 1").inputValue() === "0.4", "…as a character at the usual strength");
  await add.click();
  ok(await picker.locator("li button").first().isDisabled(), "a picture already chosen can't be added twice");
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "detached" });
  ok(await add.evaluate((b) => b === document.activeElement), "Esc closes the picker, back on Add reference");

  // ---- role and strength go into the workflow ----
  await rows.first().getByLabel("Role of reference 1").selectOption("place");
  ok(await rows.first().getByLabel("Strength of reference 1").inputValue() === "0.3", "a new role brings its usual strength");
  await rows.first().getByLabel("Strength of reference 1").fill("0.35");
  ok((await rows.first().innerText()).includes("Strength 0.35"), "the strength slider says its value");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a cellar flooding");
  await queue.click();
  await until(async () => (await tiles.count()) === 1 && (await ready()), "the picture");
  const wf = prompts().at(-1);
  const ref = nodes(wf, "IPAdapterAdvanced");
  ok(ref.length === 1 && ref[0][1].inputs.weight === 0.35 && ref[0][1].inputs.weight_type === "linear" && nodes(wf, "LoadImage").length === 1, "the workflow sent has an IPAdapterAdvanced with that weight, and the reference picture");
  const log = (await jobs(second))[0];
  ok(JSON.stringify(log.refs) === JSON.stringify([{ source: `saved:${second}:header`, label: "Header", role: "place", weight: 0.35 }]), "the job log records the reference");
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Info" }).click();
  const info = page.getByRole("dialog", { name: "Picture info" });
  await info.waitFor();
  ok((await info.innerText()).includes("References") && (await info.innerText()).includes("Header (place 0.35)"), "Info shows the reference");
  await page.keyboard.press("Escape");
  await info.waitFor({ state: "detached" });

  // ---- a seed kept between queues, or typed by hand ----
  const seedOf = (wf) => nodes(wf, "KSampler")[0][1].inputs.seed;
  ok(await page.getByLabel("Seed", { exact: true }).count() === 0, "the seed box shows only with Keep seed ticked");
  await page.getByRole("checkbox", { name: "Keep seed" }).check();
  const seedBox = page.getByLabel("Seed", { exact: true });
  ok(/^\d+$/.test(await seedBox.inputValue()), "ticking Keep seed fills in a random seed");
  await seedBox.fill("4242");
  const before = prompts().length;
  await queue.click();
  await until(async () => prompts().length === before + 1, "the first pictures to be queued");
  await until(async () => await ready(), "the first pictures");
  await queue.click();
  await until(async () => prompts().length === before + 2, "the second pictures to be queued");
  ok(prompts().slice(-2).every((p) => seedOf(p) === 4242), "both queues use the typed seed");
  await seedBox.fill("12x");
  ok(await page.getByText("The seed has to be a whole number").isVisible(), "a seed that isn't a whole number is refused, and says so");
  await page.getByRole("checkbox", { name: "Keep seed" }).uncheck();
  await until(async () => await ready(), "the pictures");

  // ---- kept per chapter and moment ----
  await until(async () => (await draft(second))?.end.refs.length === 1, "the reference to be kept");
  const kept = (await draft(second)).end.refs[0];
  ok(kept.source === `saved:${second}:header` && kept.role === "place" && kept.weight === 0.35 && (await draft(second)).start.refs.length === 0, "the reference is kept with the footer's boxes only");
  await page.reload();
  await section.waitFor();
  await until(async () => (await rows.count()) === 1, "the reference to come back");
  ok(await moment.inputValue() === "end" && await rows.first().getByLabel("Role of reference 1").inputValue() === "place" && await rows.first().getByLabel("Strength of reference 1").inputValue() === "0.35", "after a reload the footer's reference is back, with its role and strength");
  // Only pinned pictures show after a reload; the picture made earlier is under All.
  await page.locator(".illustrate-gallery").getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  await moment.selectOption("start");
  ok((await rows.count()) === 0, "…and the header's moment has none");
  await add.click();
  await picker.waitFor();
  const forHeader = (await picker.locator("li button").allInnerTexts()).join("|");
  ok(forHeader.includes("Ch. The lamp footer") && forHeader.includes("Ch. The lamp header") && forHeader.includes("This chapter's footer") === false, "making a header, the previous chapter's footer and header are suggested");
  await picker.locator("li button").first().click();
  await picker.waitFor({ state: "detached" });
  ok(await rows.first().getByLabel("Label of reference 1").inputValue() === "Ch. The lamp footer", "…labelled with the chapter");
  await moment.selectOption("end");
  ok((await rows.count()) === 1, "…and the footer's list is as it was");

  // ---- Load prompt brings the references back ----
  await rows.first().getByRole("button", { name: "Remove reference Header" }).click();
  ok((await rows.count()) === 0, "✕ removes a reference");
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Load prompt" }).click();
  await until(async () => (await rows.count()) === 1, "the references to be loaded");
  ok(await rows.first().getByLabel("Label of reference 1").inputValue() === "Header" && await rows.first().getByLabel("Strength of reference 1").inputValue() === "0.35", "Load prompt brings back the picture's references");

  // ---- Use as reference, an upload, and the limit of four ----
  await tiles.first().getByRole("button", { name: "More" }).click();
  const menu = await tiles.first().getByRole("menuitem").allInnerTexts();
  ok(menu.indexOf("Use as reference") > menu.indexOf("Change part of this…") && menu.indexOf("Use as reference") < menu.indexOf("Edit this"), "the ☰ menu has Use as reference after Change part of this…");
  await tiles.first().getByRole("menuitem", { name: "Use as reference" }).click();
  await until(async () => (await rows.count()) === 2, "the picture to be added");
  ok(await rows.nth(1).getByLabel("Label of reference 2").inputValue() === "Picture" && await rows.nth(1).locator("img").getAttribute("src") !== "", "Use as reference adds the picture");
  await page.locator(".image-editors").getByRole("button", { name: "More" }).first().click();
  await page.getByRole("menuitem", { name: "Use as reference" }).click();
  await until(async () => (await rows.count()) === 3 || (await rows.count()) === 2, "the saved header");
  ok((await rows.count()) === 2, "the saved header is already a reference, so it isn't added twice");
  await add.click();
  await picker.getByRole("tab", { name: "Upload" }).click();
  await picker.getByLabel("Reference file").setInputFiles({ name: "jim.png", mimeType: "image/png", buffer: makePng(4) });
  await picker.waitFor({ state: "detached" });
  ok((await rows.count()) === 3 && await rows.nth(2).getByLabel("Label of reference 3").inputValue() === "jim", "an uploaded picture is added, labelled with its file name");
  await add.click();
  await picker.getByRole("tab", { name: "Pictures" }).click();
  await picker.getByRole("button", { name: /Cover/ }).click();
  await picker.waitFor({ state: "detached" });
  ok((await rows.count()) === 4 && await add.isDisabled() && (await section.innerText()).includes("most a picture takes (4)"), "four references is the most: Add reference is off, with a note");
  await until(async () => (await draft(second)).end.refs.length === 3, "the references to be kept");
  ok((await draft(second)).end.refs.every((r) => !r.source.startsWith("upload:")), "an upload isn't kept");
  await page.reload();
  await section.waitFor();
  await until(async () => (await rows.count()) === 3, "the kept references");
  ok(!(await rows.allInnerTexts()).join().includes("jim"), "…and is gone after a reload");

  // ---- a preset that can't use references ----
  await drawMenu.selectOption("flux");
  await until(async () => (await section.innerText()).includes("model family"), "the reason");
  ok((await rows.count()) === 0 && (await add.count()) === 0 && (await section.getByRole("link", { name: "Settings" }).count()) === 1, "a model-family preset collapses the section to the reason and a link to Settings");
  await drawMenu.selectOption("noob");
  await until(async () => (await rows.count()) === 3, "the references to be back");

  // ---- the cover page ----
  await page.goto(`${BASE}/s/${storyId}/cover`);
  await section.waitFor();
  await add.click();
  await picker.waitFor();
  const coverChoices = await picker.locator("li button").allInnerTexts();
  ok(coverChoices.length === 1 && coverChoices[0].includes("Cover"), "on the cover page the saved cover is suggested");
  await picker.locator("li button").first().click();
  await picker.waitFor({ state: "detached" });
  await until(async () => (await call("GET", `/api/stories/${storyId}/cover-draft`)).draft?.refs.length === 1, "the cover's reference to be kept");
  await page.reload();
  await section.waitFor();
  await until(async () => (await rows.count()) === 1, "the cover's reference to come back");
  ok(await rows.first().getByLabel("Label of reference 1").inputValue() === "Cover", "the cover page keeps its reference too");

  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    for (const [width, height] of [[1000, 1500], [390, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}/c/${second}/illustrate`);
      await section.waitFor();
      await until(async () => (await rows.count()) === 3, "the references");
      await page.waitForTimeout(500);
      await section.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-refs-${width}.png` });
      ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `at ${width}px the Illustrate page does not scroll sideways`);
      await add.click();
      await picker.waitFor();
      await picker.getByRole("tab", { name: "Pictures" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-refs-picker-${width}.png` });
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "detached" });
    }
  }
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
