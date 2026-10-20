// The full-size picture viewer on the Illustrate page: opening a picture, moving with the arrow keys, the
// buttons and a swipe, pinning (P) and rejecting (X) from it, using a picture and loading its prompt, and
// closing. Jobs are put in the log through the API; the pictures come from a fake ComfyUI.
import fs from "node:fs";
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3557;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Seen large", chapter: { title: "The harbour", body: "Boats came in." } });
const chapterId = story.chapter_id;
let n = 0;
const job = (prompt, files) =>
  call("POST", "/api/picture-jobs", {
    chapter_id: chapterId, prompt_id: `v${++n}`, prompt, negative: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, seed: 500 + n, count: files.length, moment: "start",
    images: files.map((filename) => ({ filename, subfolder: "", type: "output" })),
  });
// Shown newest first: "harbour at noon" (2 pictures), then "harbour at dawn" (2 pictures).
const dawn = await job("harbour at dawn", ["StoryTime_1_0.png", "StoryTime_1_1.png"]);
const noon = await job("harbour at noon", ["StoryTime_2_0.png", "StoryTime_2_1.png"]);
const marks = async () => Object.fromEntries((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.map((j) => [j.prompt.replace("harbour at ", ""), j.marks.map((m) => m ?? "-").join(",")]));

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT });
await putSettings({ ...(before ?? {}), comfy: { url: comfy.url, workflow: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, count: 2 } });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const gallery = page.locator(".chapter-pictures");
const tiles = gallery.locator(".candidates .picture-tile");
const viewer = page.getByRole("dialog", { name: "Picture viewer" });
const count = () => viewer.locator(".viewer-count").innerText();
const shownFile = async () => new URL(await viewer.locator(".viewer-stage img").getAttribute("src")).searchParams.get("filename");
const showAll = async () => {
  await gallery.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  await tiles.nth(3).waitFor();
};

try {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await gallery.getByRole("heading", { name: "Pictures" }).waitFor();
  await showAll();

  // ---- open ----
  await tiles.nth(1).locator("a").click();
  await viewer.waitFor();
  ok(await viewer.evaluate((d) => d.open && d.matches(":modal")), "clicking a picture opens the viewer, as a modal dialog");
  ok(await count() === "2 of 4" && await shownFile() === "StoryTime_2_1.png", "…on that picture, counted among the view's pictures in the order shown");
  ok((await viewer.locator(".viewer-prompt").innerText()) === "harbour at noon" && (await viewer.locator(".viewer-caption").innerText()).startsWith("fake_sdxl_a · 1344 × 768 · seed 502"), "…with its prompt and settings");
  ok((await viewer.locator(".viewer-keys").innerText()).includes("P pin · X reject"), "…and, with a mouse, the keys to use");
  const box = await viewer.locator(".viewer-stage img").boundingBox();
  ok(box.width > 1000, `…as large as the screen allows (${Math.round(box.width)} × ${Math.round(box.height)})`);
  ok(page.url().endsWith("/illustrate"), "…without leaving the page");

  // ---- moving ----
  await page.keyboard.press("ArrowRight");
  ok(await count() === "3 of 4" && await shownFile() === "StoryTime_1_0.png", "→ shows the next picture, into the next prompt's group");
  await page.keyboard.press("ArrowRight");
  ok(await count() === "4 of 4" && await viewer.getByRole("button", { name: "Next picture" }).count() === 0, "…up to the last, which has no Next");
  await page.keyboard.press("ArrowRight");
  ok(await count() === "4 of 4", "…and → there stays put");
  await page.keyboard.press("ArrowLeft");
  ok(await count() === "3 of 4", "← goes back");
  await viewer.getByRole("button", { name: "Previous picture" }).click();
  ok(await count() === "2 of 4", "…as does the Previous button");
  await viewer.getByRole("button", { name: "Next picture" }).click();
  ok(await count() === "3 of 4", "…and Next goes on");
  // a swipe to the left goes on, one to the right goes back
  const stage = await viewer.locator(".viewer-stage").boundingBox();
  const swipe = async (from, to) => {
    const y = stage.y + stage.height / 2;
    await page.mouse.move(stage.x + from, y);
    await page.mouse.down();
    await page.mouse.move(stage.x + to, y, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(stage.width * 0.7, stage.width * 0.3);
  ok(await count() === "4 of 4", "a swipe to the left shows the next picture");
  await swipe(stage.width * 0.3, stage.width * 0.7);
  ok(await count() === "3 of 4", "…and one to the right the previous");

  // ---- pin and reject ----
  await page.keyboard.press("p");
  ok(await until(async () => (await marks()).dawn === "pinned,-", "the pin"), "P pins the picture shown");
  ok(await viewer.getByRole("button", { name: "Unpin", exact: true }).getAttribute("aria-pressed") === "true" && (await viewer.innerText()).includes("Pinned."), "…the viewer shows it pinned, and says so");
  await page.keyboard.press("P");
  ok(await until(async () => (await marks()).dawn === "-,-", "the unpin"), "P again unpins it");
  await page.keyboard.press("x");
  ok(await until(async () => (await marks()).dawn === "rejected,-", "the reject"), "X rejects it");
  ok(await count() === "3 of 3" && await shownFile() === "StoryTime_1_1.png", "…it leaves All, and the viewer moves on to the next picture");
  await viewer.getByRole("button", { name: "Undo" }).click();
  ok(await until(async () => (await marks()).dawn === "-,-", "the undo"), "Undo in the viewer brings it back");
  ok(await count() === "4 of 4", "…into the list again");
  await viewer.getByRole("button", { name: "Pin", exact: true }).click();
  ok(await until(async () => (await marks()).dawn === "-,pinned", "the button pin"), "the Pin button pins too");

  // ---- use it ----
  await viewer.getByRole("button", { name: "More" }).click();
  await viewer.getByRole("menuitem", { name: "Use as header picture" }).click();
  await viewer.getByText("Saved as the header picture.").waitFor();
  const header = (await call("GET", `/api/stories/${story.story_id}/export?format=json`)).images.find((i) => i.slot === "header");
  ok(header?.prompt === "harbour at dawn", "Use as header in the viewer's ☰ menu saves the picture shown, with its prompt");
  await viewer.locator(".picture-in-use").waitFor();
  ok((await viewer.locator(".picture-in-use").innerText()).trim() === "Header", "…which then shows it is the header, on the picture");
  await viewer.getByRole("button", { name: "More" }).click();
  ok(await viewer.getByRole("menuitem", { name: "This is the header picture" }).getAttribute("aria-disabled") === "true", "…and in its menu");
  await page.keyboard.press("Escape");
  const usedAt = await count();
  await page.keyboard.press("ArrowLeft");
  ok(await viewer.locator(".picture-in-use").count() === 0 && await count() !== usedAt, "…and the picture before it doesn't (the keys still work after saving)");
  // the same buttons, in the same place, as on a tile
  const viewerButtons = await viewer.locator(".picture-marks > button, .picture-marks .tile-menu > button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  const tileButtons = await tiles.first().locator(".picture-marks > button, .picture-marks .tile-menu > button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  ok(viewerButtons.join() === "Pin,Reject,More" && tileButtons.join() === viewerButtons.join(), `the viewer has the tile's buttons, in the same order (${viewerButtons.join()})`);
  const frame = await viewer.locator(".viewer-frame").boundingBox();
  const marksBox = await viewer.locator(".picture-marks").boundingBox();
  const shown = await viewer.locator(".viewer-frame img").evaluate((i) => i.naturalWidth / i.naturalHeight);
  ok(Math.abs(frame.x + frame.width - (marksBox.x + marksBox.width)) < 12 && Math.abs(marksBox.y - frame.y) < 12, "…on the picture's top right corner");
  ok(Math.abs(frame.width / frame.height - shown) < 0.02, "…which is the picture's own shape");
  await viewer.getByRole("button", { name: "More" }).click();
  ok((await viewer.getByRole("menuitem").allInnerTexts()).join("|") === "Use as header picture|Use as footer picture|Redraw from this|Edit this|Load prompt|Info|Open in a new tab", "its ☰ menu has Use as header and footer, Redraw from this, Edit this, Load prompt, Info and Open in a new tab");
  await page.keyboard.press("Escape");
  ok(await viewer.getByRole("menu").count() === 0 && await viewer.isVisible(), "Esc closes the menu, not the viewer");
  const viewedPrompt = await viewer.locator(".viewer-prompt").innerText();
  await viewer.getByRole("button", { name: "More" }).click();
  await viewer.getByRole("menuitem", { name: "Info" }).click();
  const info = page.getByRole("dialog", { name: "Picture info" });
  await info.waitFor();
  const infoBox = await info.boundingBox();
  const atInfo = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("dialog")?.className, [infoBox.x + infoBox.width / 2, infoBox.y + 20]);
  ok(atInfo === "picture-info" && (await info.innerText()).includes(viewedPrompt), "Info opens over the viewer, for the picture shown");
  await page.keyboard.press("Escape");
  await info.waitFor({ state: "detached" });
  ok(await viewer.isVisible(), "…and Esc closes Info, not the viewer");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  // ---- close ----
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "detached" });
  ok(true, "Esc closes the viewer");
  ok((await tiles.nth(3).getAttribute("class")).includes("pinned"), "…and the panel shows the pin made in it");
  await tiles.first().locator("a").click();
  await viewer.waitFor();
  await viewer.getByRole("button", { name: "Close" }).click();
  await viewer.waitFor({ state: "detached" });
  ok(true, "the Close button closes it too");

  // ---- load a prompt from it ----
  await tiles.first().locator("a").click();
  await viewer.waitFor();
  await viewer.getByRole("button", { name: "More" }).click();
  await viewer.getByRole("menuitem", { name: "Load prompt" }).click();
  await viewer.waitFor({ state: "detached" });
  ok((await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue()) === "harbour at noon" && await page.getByText("Reuse seed 502").isVisible(), "Load prompt closes the viewer and brings back the picture's prompt and seed");

  // ---- Ctrl+click still opens a new tab ----
  const [tab] = await Promise.all([context.waitForEvent("page"), tiles.first().locator("a").click({ modifiers: ["Control"] })]);
  ok(tab.url().startsWith(`${comfy.url}/view?`) && await viewer.count() === 0, "Ctrl+click opens the picture in a new tab instead");
  await tab.close();

  // ---- Pinned & new: unpinning there moves on ----
  await gallery.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Pinned & new/ }).click();
  await tiles.first().locator("a").click();
  await viewer.waitFor();
  ok(await count() === "1 of 1", "in Pinned & new the viewer goes through the pinned picture only");
  await page.keyboard.press("p");
  await viewer.waitFor({ state: "detached" });
  ok(await until(async () => (await marks()).dawn === "-,-", "the unpin"), "unpinning the only one there closes the viewer");

  // ---- phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  await showAll();
  await tiles.first().locator("a").click();
  await viewer.waitFor();
  const fit = await page.evaluate(() => {
    const d = document.querySelector("dialog.picture-viewer");
    const wide = [...d.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length;
    const img = d.querySelector(".viewer-stage img").getBoundingClientRect();
    return { wide, img: img.width, bottom: d.querySelector(".viewer-bottom").getBoundingClientRect().bottom, h: window.innerHeight };
  });
  ok(fit.wide === 0 && fit.img > 350 && fit.bottom <= fit.h + 1, `on a phone the viewer fits the screen: the picture full width (${Math.round(fit.img)}px), the buttons in view`);
  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-viewer-390.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-viewer-1280.png` });
  }
  void dawn;
  void noon;
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
