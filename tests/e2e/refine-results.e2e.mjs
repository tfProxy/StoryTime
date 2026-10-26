// Refine screen: using the Results. Clicking a tile selects it (once; again lets go; only one at a time); the main window
// then shows the result, editing is off (tools, Undo/Redo, Go; zoom still works), Previous / Next and the arrow keys go
// along the tray, Apply makes it the working picture (paint cleared, mask kept, one undo step, the result stays in the
// tray with an “In use” badge, any result can be applied again), Discard removes it and moves on. A reload keeps the
// applied picture and Undo still works; a result of another size is resampled to the working picture's size and
// uploaded to ComfyUI's input folder; Reset in the Prompt panel goes back to the applied result's own prompt.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3563;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Refine results", chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
const chapterId = story.chapter_id;
const storyId = story.story_id ?? story.id;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 40, startDelay: 60 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

// The fake ComfyUI colours a picture by the number at the end of its file name: 0 red, 1 blue, 2 green, 3 yellow, 5 teal.
const COLORS = { 0: [220, 70, 60], 1: [60, 140, 220], 2: [70, 180, 90], 3: [230, 190, 50], 5: [60, 190, 190] };
const near = (a, b, tol = 28) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  const sessionId = "resultsess01";
  const stage = page.locator(".refine-stage");
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const box = (name) => page.getByRole("textbox", { name, exact: true });
  const slider = (name) => page.getByRole("slider", { name, exact: true });
  const tray = page.locator("[data-result-index]");
  const tileAt = (index) => page.locator(`[data-result-index="${index}"] button`);
  const trayTile = (n) => tray.nth(n).locator("button");
  const attr = (name) => stage.getAttribute(name);
  const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`storytime.refine.${id}`) ?? "null"), sessionId);
  const settle = () => page.waitForTimeout(700); // the session is saved a moment after a change
  // One evaluation, so the selection can't go away between counting it and reading it.
  const selectedIndex = () => page.evaluate(() => {
    const sel = document.querySelectorAll('[data-result-index][data-selected="true"]');
    return sel.length === 1 ? Number(sel[0].getAttribute("data-result-index")) : null;
  });
  const pixel = (layer, fx, fy) => page.evaluate(([l, x, y]) => {
    const c = document.querySelector(`canvas[data-layer=${l}]`);
    return c ? [...c.getContext("2d").getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data] : null;
  }, [layer, fx, fy]);
  const edge = (layer) => pixel(layer, 0.03, 0.5); // the left edge, where the fake's gradient has hardly darkened the colour
  const baseIs = async (n) => near(await edge("base"), COLORS[n]);
  const previewIs = async (n) => near(await edge("preview"), COLORS[n]);
  const frame = () => page.locator(".refine-frame").boundingBox();
  const drag = async (fx0, fy0, fx1, fy1) => {
    const b = await frame();
    await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 8 });
    await page.mouse.up();
  };
  const strokes = async () => Number(await attr("data-strokes"));
  const maskStrokes = async () => Number(await attr("data-mask-strokes"));
  const ready = () => page.locator('.refine-stage[data-ready="1"]').waitFor();
  const badges = () => page.locator('[aria-label="In use"]');
  const badgeIndex = async () => ((await badges().count()) === 1 ? Number(await page.locator('[data-in-use="true"]').getAttribute("data-result-index")) : null);
  const prompts = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");
  const nav = (name) => page.getByRole("button", { name, exact: true });
  const uploads = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/upload/image").length;
  const sizeOfUpload = (name) => page.evaluate(async (b64) => {
    const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
    return [bmp.width, bmp.height];
  }, comfy.uploaded(name)?.toString("base64") ?? "");

  // ================= a session on a picture of the fake ComfyUI =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  const now = Date.now();
  await page.evaluate(([id, s]) => localStorage.setItem(`storytime.refine.${id}`, JSON.stringify(s)), [sessionId, {
    id: sessionId, target: { kind: "chapter", storyId, chapterId }, createdAt: now, updatedAt: now,
    original: { kind: "comfy", image: { filename: "StoryTime_900_5.png", subfolder: "", type: "output" } },
    prompt: "a keeper at a lamp", negative: "ugly", sourcePrompt: "a keeper at a lamp", sourceNegative: "ugly", sourceAlways: "", loras: null, results: [],
    history: { past: [], future: [], present: { base: "original", paint: [], mask: { strokes: [], softness: 0, inverted: false }, paintVisible: true, maskVisible: true } },
  }]);
  await page.goto(`${BASE}/refine/${sessionId}`);
  await ready();
  ok(await baseIs(5), "the screen opens on the original picture");
  await box("Prompt").fill("a keeper in the rain"); // so the results' prompt differs from the original's
  await page.getByRole("combobox", { name: "Pictures per click" }).selectOption("4");
  await btn("Go").click();
  await until(async () => (await tray.count()) === 4, "four results");
  ok((await tray.count()) === 4 && (await selectedIndex()) === null && (await attr("data-previewing")) === "false", "Go made four results; none is selected and the screen is editing");
  ok(await nav("Apply").isDisabled() && await nav("Trash").isDisabled() && (await nav("Previous result").count()) === 0, "Apply and Trash are there but off, and there is no Previous / Next, while nothing is selected");

  // Paint and a mask on the original, to see what Apply does to them.
  await btn("Paint brush").click();
  await page.getByRole("textbox", { name: "Colour as hex" }).fill("#00ff00");
  await slider("Paint size").fill("20");
  await drag(0.2, 0.5, 0.8, 0.5);
  await btn("Mask brush").click();
  await slider("Mask brush size").fill("20");
  await drag(0.3, 0.3, 0.4, 0.3);
  ok((await strokes()) === 1 && (await maskStrokes()) === 1, "one paint stroke and one mask stroke on the original");

  // ================= selecting =================
  await tileAt(3).click();
  ok((await selectedIndex()) === 3 && (await tileAt(3).getAttribute("aria-pressed")) === "true" && (await tileAt(2).getAttribute("aria-pressed")) === "false", "clicking a tile selects it (aria-pressed)");
  await until(async () => (await attr("data-preview-ready")) === "1", "the result to load");
  ok((await attr("data-previewing")) === "true" && (await attr("data-preview-key")).includes("StoryTime_") && (await previewIs(3)), "the main window shows that result (data-previewing, its picture)");
  ok((await page.locator("canvas[data-layer=paint]").evaluate((c) => getComputedStyle(c).visibility)) === "hidden" && (await page.locator("canvas[data-layer=mask]").evaluate((c) => getComputedStyle(c).visibility)) === "hidden", "the paint and mask layers are hidden while it is on show");
  ok(await btn("Mask brush").isDisabled() && await btn("Paint brush").isDisabled() && await slider("Paint size").isDisabled() && await btn("Show mask").isDisabled() && await btn("Invert mask").isDisabled(), "the Mask and Paint tools are off");
  ok(await btn("Undo").isDisabled() && await btn("Redo").isDisabled() && await btn("Go").isDisabled() && (await btn("Go").getAttribute("title")).includes("Apply it or Trash it"), "Undo, Redo and Go are off (Go says why)");
  ok(await btn("Keep picture").isDisabled() && (await btn("Keep picture").getAttribute("title")) === "Apply or deselect the result first", "Accept is off while a result is on show (and says why)");
  await drag(0.2, 0.7, 0.8, 0.7);
  ok((await strokes()) === 1 && (await maskStrokes()) === 1, "dragging on the picture draws nothing");
  const f0 = await frame();
  await page.mouse.move(f0.x + f0.width / 2, f0.y + f0.height / 2);
  await page.mouse.wheel(0, -400);
  await page.locator("button.refine-fit").waitFor();
  ok(true, "the wheel still zooms (Fit appears)");
  await page.locator("button.refine-fit").click();
  await page.keyboard.press("Control+z");
  ok((await strokes()) === 1, "Ctrl+Z does nothing while a result is on show");

  // only one at a time; again lets go
  await tileAt(1).click();
  ok((await selectedIndex()) === 1 && (await page.locator('[data-result-index] [aria-pressed="true"]').count()) === 1, "selecting another moves the selection: only one is selected");
  await until(async () => (await previewIs(1)), "result 1 on show");
  await tileAt(1).click();
  ok((await selectedIndex()) === null && (await attr("data-previewing")) === "false" && await btn("Go").isEnabled() && await btn("Undo").isEnabled() && await btn("Mask brush").isEnabled(), "clicking the selected tile again lets go: editing is back");
  ok((await pixel("paint", 0.5, 0.5))[3] > 0 && (await pixel("paint", 0.5, 0.5)).slice(0, 3).join() === "0,255,0" && (await baseIs(5)), "…with the paint and the original picture as they were");

  // ================= Previous / Next, the arrow keys =================
  // The tray is newest first: result 4 (index 3) is first, so Previous is off there.
  await tileAt(3).click();
  ok(await nav("Previous result").isDisabled() && await nav("Next result").isEnabled(), "at the first tile of the tray Previous is off and Next on");
  await nav("Next result").click();
  ok((await selectedIndex()) === 2, "Next goes to the next tile along the tray");
  await until(async () => (await previewIs(2)), "result 2 on show");
  await page.keyboard.press("ArrowRight");
  ok((await selectedIndex()) === 1, "the → key does the same");
  await page.keyboard.press("ArrowLeft");
  ok((await selectedIndex()) === 2, "the ← key goes back");
  await nav("Previous result").click();
  ok((await selectedIndex()) === 3, "Previous goes back along the tray");
  await box("Prompt").focus();
  await page.keyboard.press("ArrowRight");
  ok((await selectedIndex()) === 3, "arrow keys in a text box move the cursor, not the selection");
  await tileAt(0).click();
  ok(await nav("Next result").isDisabled() && await nav("Previous result").isEnabled(), "at the last tile of the tray Next is off");
  await page.keyboard.press("ArrowRight");
  ok((await selectedIndex()) === 0, "→ at the end stays where it is");
  await tileAt(0).click();

  // ================= zoom and pan stay =================
  const sbox = await stage.boundingBox();
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await until(async () => (await frame()).width > sbox.width * 1.2, "zoomed in");
  const zoomed = await frame();
  await tileAt(2).click();
  await until(async () => (await attr("data-preview-ready")) === "1" && (await previewIs(2)), "result 2 on show");
  const zoomedReview = await frame();
  ok(Math.abs(zoomedReview.width - zoomed.width) < 2 && zoomedReview.width > sbox.width * 1.2, "looking at a result keeps the zoom");
  await nav("Next result").click();
  await until(async () => (await previewIs(1)), "result 1 on show");
  ok(Math.abs((await frame()).width - zoomedReview.width) < 2, "…and so does going from one result to the next");
  await tileAt(1).click();
  await until(async () => (await attr("data-previewing")) === "false", "back to editing");
  ok(Math.abs((await frame()).width - zoomed.width) < 2, "…and so does going back to editing");

  // ================= Apply =================
  await box("Prompt").fill("custom text");
  await tileAt(1).click();
  await until(async () => (await attr("data-preview-ready")) === "1" && (await previewIs(1)), "result 1 on show");
  const head = await page.locator(".refine-head").boundingBox();
  const bar = await page.locator(".refine-bar").boundingBox();
  ok(await nav("Keep picture").isVisible() && await nav("Cancel").isVisible() && (await nav("Cancel").boundingBox()).y < head.y + head.height && bar && await nav("Apply").isEnabled() && await nav("Trash").isEnabled(), "Accept and Cancel are in the toolbar at the top; Apply and Trash are in the tools bar and on");
  await nav("Apply").click();
  await until(async () => (await selectedIndex()) === null && (await baseIs(1)), "Apply to switch the picture");
  await until(async () => Math.abs((await frame()).width - zoomed.width) < 2, "the zoom kept after Apply");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  ok((await baseIs(1)) && (await attr("data-previewing")) === "false", "Apply makes the result the working picture and goes back to editing");
  ok((await strokes()) === 0 && (await maskStrokes()) === 1, "…the paint is cleared and the mask is kept");
  ok((await tray.count()) === 4 && (await badgeIndex()) === 1, "…the result stays in the tray, with the “In use” badge");
  ok((await box("Prompt").inputValue()) === "custom text", "…the text typed in the Prompt box is not changed");
  await settle();
  const s1 = await stored();
  const id1 = Object.keys(s1.bases).find((k) => k.startsWith("result:"));
  ok(s1.history.present.base === id1 && s1.history.past.length >= 3 && Object.keys(s1.bases).length === 2 && s1.bases[id1].original.kind === "comfy" && s1.bases[id1].prompt === s1.results[1].prompt, "the session keeps the new base (the result's own picture and prompt)");
  await btn("Reset prompt").click();
  ok((await box("Prompt").inputValue()) === s1.results[1].prompt, "Reset in the Prompt panel restores the applied result's own prompt");
  ok(s1.results[1].prompt.includes("in the rain") && s1.results[1].prompt !== "a keeper at a lamp", "(the results' own prompt differs from the original's)");
  await btn("Undo").click();
  await until(async () => (await baseIs(5)), "Undo to give back the original");
  ok((await baseIs(5)) && (await strokes()) === 1 && (await maskStrokes()) === 1 && (await badges().count()) === 0, "Undo gives back the previous picture and its paint (the badge goes)");
  ok((await tray.count()) === 4, "…and the tray is as it was");
  await btn("Reset prompt").click();
  ok((await box("Prompt").inputValue()) === "a keeper at a lamp", "…and Reset goes back to the original's prompt");
  await btn("Redo").click();
  await until(async () => (await baseIs(1)), "Redo to apply again");
  ok((await baseIs(1)) && (await strokes()) === 0 && (await badgeIndex()) === 1, "Redo applies it again");

  // Apply 2, then 1 again.
  await tileAt(2).click();
  await until(async () => (await previewIs(2)), "result 2 on show");
  await nav("Apply").click();
  await until(async () => (await baseIs(2)), "result 2 to be applied");
  ok((await badgeIndex()) === 2 && (await tray.count()) === 4, "applying result 3 moves the badge; the other stays in the tray");
  await tileAt(1).click();
  await until(async () => (await previewIs(1)), "result 1 on show");
  await nav("Apply").click();
  await until(async () => (await baseIs(1)), "result 1 to be applied again");
  ok((await badgeIndex()) === 1 && (await maskStrokes()) === 1, "applying result 2 again gives its picture again, and the mask is still kept");
  await settle();
  const s2 = await stored();
  ok(Object.keys(s2.bases).length === 3, "each applied result is a base once (the original and two results)");
  const uploadsAfterSame = uploads();

  // ================= reload =================
  await page.reload();
  await ready();
  ok((await baseIs(1)) && (await tray.count()) === 4 && (await badgeIndex()) === 1 && (await selectedIndex()) === null, "a reload keeps the applied picture, the tray and the badge; nothing is selected");
  await btn("Undo").click();
  await until(async () => (await baseIs(2)), "undo after a reload");
  ok((await baseIs(2)) && (await badgeIndex()) === 2, "Undo after a reload gives back the previous picture (the bases were kept)");
  await btn("Undo").click();
  await until(async () => (await baseIs(1)), "second undo");
  await btn("Redo").click();
  await btn("Redo").click();
  await until(async () => (await baseIs(1)), "redo back");
  ok((await baseIs(1)) && (await badgeIndex()) === 1, "…and Redo goes forward again");
  ok(uploads() === uploadsAfterSame, "no picture was uploaded for any of this");

  // ================= Discard =================
  // The tray, newest first, is now: index 3, 2, 1 (in use), 0.
  await trayTile(3).click(); // index 0, the last
  await nav("Trash").click();
  ok((await tray.count()) === 3 && (await selectedIndex()) !== null && (await attr("data-previewing")) === "true", "Discard removes the result and keeps reviewing");
  const sel1 = await page.locator('[data-result-index][data-selected="true"]');
  ok((await sel1.getAttribute("data-in-use")) === "true", "…at the end of the tray the previous one (here the one in use) is selected");
  await until(async () => (await previewIs(1)), "result 2 on show");
  await sel1.locator("button").click();
  ok((await tray.count()) === 3 && (await selectedIndex()) === null, "(let go of it)");
  await trayTile(0).click(); // the newest
  await until(async () => (await previewIs(3)), "result 4 on show");
  await nav("Trash").click();
  ok((await tray.count()) === 2, "the newest is discarded");
  await until(async () => (await previewIs(2)), "the next result on show");
  ok((await selectedIndex()) === 1 && (await previewIs(2)), "…and the next in the tray is selected and shown");
  await nav("Trash").click();
  await until(async () => (await previewIs(1)), "the last result on show");
  ok((await tray.count()) === 1 && (await selectedIndex()) === 0 && (await previewIs(1)), "discarding the first of two selects the one left");
  ok(await baseIs(1), "(the working picture was never touched)");
  await settle();
  ok((await stored()).results.length === 1, "the session keeps only the results left");
  await page.reload();
  await ready();
  ok((await tray.count()) === 1 && (await selectedIndex()) === null && (await baseIs(1)), "a reload keeps the discards; nothing is selected");
  await trayTile(0).click();
  await nav("Trash").click();
  ok((await tray.count()) === 0 && (await attr("data-previewing")) === "false" && await nav("Apply").isDisabled() && await btn("Go").isEnabled(), "trashing the only result goes back to editing");
  ok((await baseIs(1)) && (await badges().count()) === 0, "…the working picture stays, and no badge as its result is gone");
  ok((await page.getByText("Pictures made with Go appear here.").count()) === 1, "…and the tray says it is empty");
  await settle();

  // ================= a result of another size =================
  // The next job's pictures; the third (…_2.png) is made 112 x 64 against the 96 x 60 working picture.
  await btn("Go").click();
  await until(async () => (await tray.count()) === 4, "four more results");
  await settle();
  const made = (await stored()).results;
  comfy.setMode({ viewSizes: { [made[2].image.filename]: [112, 64] } });
  const dims0 = await page.evaluate(() => { const c = document.querySelector("canvas[data-layer=base]"); return [c.width, c.height]; });
  ok(dims0.join() === "96,60", "the working picture is 96 x 60");
  const up0 = uploads();
  await tileAt(2).click();
  await until(async () => (await attr("data-preview-ready")) === "1" && (await previewIs(2)), "the big result on show");
  const pdims = await page.evaluate(() => { const c = document.querySelector("canvas[data-layer=preview]"); return [c.width, c.height]; });
  ok(pdims.join() === "112,64", "the result on show is 112 x 64");
  await nav("Apply").click();
  await until(async () => (await selectedIndex()) === null && uploads() === up0 + 1, "the resampled picture to be uploaded");
  await until(async () => (await attr("data-ready")) === "1" && (await baseIs(2)), "the resampled picture to load");
  ok(uploads() === up0 + 1, "applying it uploaded one picture to ComfyUI");
  await settle();
  const s3 = await stored();
  const bigId = Object.keys(s3.bases).find((k) => k.endsWith(made[2].image.filename));
  const bigBase = s3.bases[bigId].original;
  ok(bigBase.kind === "comfy" && bigBase.image.type === "input" && bigBase.image.subfolder === "" && bigBase.image.filename.startsWith("storytime-refine-"), `the base is the uploaded picture in ComfyUI's input folder (${bigBase.image.filename})`);
  ok((await sizeOfUpload(bigBase.image.filename)).join() === "96,60", "…resampled to the working picture's size (96 x 60)");
  const dims1 = await page.evaluate(() => { const c = document.querySelector("canvas[data-layer=base]"); return [c.width, c.height]; });
  ok(dims1.join() === "96,60" && (await strokes()) === 0 && (await maskStrokes()) === 1 && (await badgeIndex()) === 2, "the working picture is still 96 x 60 (the mask fits), with the mask kept and the badge on the result");
  await tileAt(1).click();
  await until(async () => (await previewIs(1)), "another result on show");
  await nav("Apply").click();
  await until(async () => (await baseIs(1)), "another result applied");
  await tileAt(2).click();
  await until(async () => (await previewIs(2)), "the big result on show again");
  await nav("Apply").click();
  await until(async () => (await baseIs(2)), "the big result applied again");
  ok(uploads() === up0 + 1, "applying it again does not upload it again");
  await page.reload();
  await ready();
  ok((await baseIs(2)) && (await page.evaluate(() => { const c = document.querySelector("canvas[data-layer=base]"); return [c.width, c.height].join(); })) === "96,60" && (await badgeIndex()) === 2, "after a reload the resampled picture loads from the input folder at 96 x 60");

  // ================= a phone =================
  await tileAt(3).click();
  await until(async () => (await previewIs(3)), "result 4 on show");
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/refine-results-1280.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 390 px a result on show does not scroll the page sideways");
  const taps = await page.evaluate(() => [...document.querySelectorAll(".refine-nav, .refine-bar button, .refine-finish button, .refine-result-pick")].map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  ok(taps.length >= 7 && taps.every((t) => t >= 40), `…and the buttons are big enough to tap (${taps.join(" ")})`);
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/refine-results-390.png`, fullPage: true });
  await context.close();
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
