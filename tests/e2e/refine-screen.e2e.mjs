// The Refine screen (/refine/<session>): opened from a picture's ☰ menu → Refine…; paint, airbrush, paint eraser and
// eyedropper on a paint layer; a mask (brush, eraser, lasso, invert, soft edge); show/hide for each; undo and redo;
// the session kept in this browser (reload restores everything); pen pressure and palm rejection; Accept is on (its
// behaviour is in refine-accept.e2e.mjs); Cancel asks first when there are changes, deletes the session and goes back; and nothing scrolls sideways at
// 390 px. The picture comes from the fake ComfyUI; the session lives only in the browser's localStorage.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3559;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Refining", chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

const browser = await launch();
const made = []; // the sessions this test opened (they live in its browser contexts' localStorage, which are closed at the end)

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  const tiles = page.locator(".candidates li.picture-tile");
  const stage = page.locator(".refine-stage");
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const sessionId = () => /\/refine\/([a-z0-9]+)/.exec(page.url())?.[1];
  const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`storytime.refine.${id}`) ?? "null"), sessionId());
  const strokes = async () => Number(await stage.getAttribute("data-strokes"));
  const maskStrokes = async () => Number(await stage.getAttribute("data-mask-strokes"));
  // How much of a layer is painted: pixels with some alpha, the strongest alpha, and the average colour of the solid ones.
  const stats = (layer) =>
    page.evaluate((l) => {
      const c = document.querySelector(`canvas[data-layer=${l}]`);
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0, max = 0, r = 0, g = 0, b = 0, solid = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8) n++;
        if (d[i + 3] > max) max = d[i + 3];
        if (d[i + 3] > 240) { r += d[i]; g += d[i + 1]; b += d[i + 2]; solid++; }
      }
      return { n, max, solid, rgb: solid ? [r / solid, g / solid, b / solid].map(Math.round) : null, w: c.width, h: c.height };
    }, layer);
  const pixel = (layer, fx, fy) =>
    page.evaluate(([l, x, y]) => {
      const c = document.querySelector(`canvas[data-layer=${l}]`);
      return [...c.getContext("2d").getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data];
    }, [layer, fx, fy]);
  const box = () => page.locator(".refine-frame").boundingBox();
  const drag = async (fx0, fy0, fx1, fy1, steps = 8) => {
    const b = await box();
    await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps });
    await page.mouse.up();
  };
  const setRange = async (label, value) => { await page.getByRole("slider", { name: label, exact: true }).fill(String(value)); };
  const hex = page.getByRole("textbox", { name: "Colour as hex" });
  const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;

  // ================= a picture, and its ☰ menu =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper at a lamp");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(async () => (await tiles.count()) === 1 && (await ready()), "the first picture", 150);

  await tiles.first().getByRole("button", { name: "More" }).click();
  const menu = await tiles.first().getByRole("menuitem").allInnerTexts();
  ok(menu.includes("Refine…") && menu.includes("Instruct changes") && menu.includes("Use as reference") && !menu.includes("Redraw from this") && !menu.includes("Change part of this…") && !menu.includes("Edit this"), `the ☰ menu offers Refine… and Instruct changes, and no longer Redraw from this, Change part of this… or Edit this (${menu.join(" | ")})`);
  await tiles.first().getByRole("menuitem", { name: "Refine…" }).click();
  await page.waitForURL(/\/refine\/[a-z0-9]+$/);
  made.push(sessionId());
  ok(true, "Refine… opens /refine/<session>");
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  ok((await page.title()) === "Refine picture" && await page.getByRole("heading", { name: "Refine picture" }).isVisible(), "the page is titled Refine picture");
  const first = await stored();
  ok(first?.original?.kind === "comfy" && first.target.kind === "chapter" && first.target.chapterId === chapterId && first.prompt === "a keeper at a lamp", "the session records the picture, the page it came from and its prompt");
  ok((await stats("base")).w === 96, "the working picture is loaded at its own size");

  // ================= layout =================
  ok(await btn("Keep picture").isEnabled() && (await btn("Keep picture").getAttribute("title")) === "Keep this picture and go back", "Accept is there and on once the picture is loaded (tests/e2e/refine-accept.e2e.mjs covers what it does)");
  ok(await btn("Undo").isDisabled() && await btn("Redo").isDisabled(), "Undo and Redo start off");
  const lay = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { tools: r(".refine-tools"), picture: r(".refine-picture"), bar: r(".refine-bar"), overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(lay.tools.width > 300 && lay.tools.width < 400 && lay.picture.left >= lay.tools.right && !lay.overflowX, `wide screen: tools on the left (${Math.round(lay.tools.width)}px), picture on the right`);
  ok(lay.bar.top >= lay.tools.top && lay.bar.bottom <= lay.tools.bottom + 1, "…and the bar sits at the bottom of the tools column");

  // ================= the eyedropper =================
  await btn("Eyedropper").click();
  ok((await btn("Eyedropper").getAttribute("aria-pressed")) === "true" && (await btn("Paint brush").getAttribute("aria-pressed")) === "false", "choosing a tool marks it pressed");
  await hex.fill("#0000ff");
  await drag(0.1, 0.5, 0.12, 0.5, 2);
  const picked = (await hex.inputValue()).toLowerCase();
  const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(picked.slice(i, i + 2), 16));
  ok(/^#[0-9a-f]{6}$/.test(picked) && pr > 150 && pg < 120 && pb < 110, `the eyedropper takes the picture's colour (${picked})`);
  ok(await strokes() === 0 && await btn("Undo").isDisabled(), "…and picking is not an undo step");
  const swatch = await page.locator(".refine-swatch").getAttribute("data-color");
  ok(swatch === picked, "the swatch shows the current colour");

  // ================= Ctrl is the eyedropper =================
  await btn("Paint brush").click();
  await page.keyboard.down("Control");
  ok((await btn("Eyedropper").getAttribute("aria-pressed")) === "true" && (await stage.getAttribute("data-tool")) === "eyedropper", "holding Ctrl switches to the eyedropper");
  await page.keyboard.up("Control");
  ok((await btn("Paint brush").getAttribute("aria-pressed")) === "true" && (await stage.getAttribute("data-tool")) === "paint-brush", "…and letting go puts the chosen tool back");

  // ================= Space is the pan tool =================
  await page.keyboard.down("Space");
  ok((await btn("Pan").getAttribute("aria-pressed")) === "true" && (await stage.getAttribute("data-tool")) === "pan", "holding Space switches to the Pan tool");
  await page.keyboard.up("Space");
  ok((await btn("Paint brush").getAttribute("aria-pressed")) === "true" && (await stage.getAttribute("data-tool")) === "paint-brush", "…and letting go puts the chosen tool back");
  await page.getByRole("textbox", { name: "Colour as hex" }).focus();
  await page.keyboard.down("Space");
  ok((await stage.getAttribute("data-tool")) === "paint-brush", "…but not while typing in a text box");
  await page.keyboard.up("Space");
  await page.locator(".refine-stage").focus().catch(() => {});

  // ================= panning =================
  const sb = await stage.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await until(async () => (await box()).width > sb.width * 1.2, "the picture zoomed in");
  const panFrom = await box();
  await btn("Pan").click();
  ok((await btn("Pan").getAttribute("aria-pressed")) === "true", "the Pan tool is in the Paint section");
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 + 30, sb.y + sb.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  const panned = await box();
  ok(Math.abs(panned.x - panFrom.x - 30) < 2 && Math.abs(panned.y - panFrom.y - 20) < 2 && await strokes() === 0, "dragging with the Pan tool moves the picture and draws nothing");
  await btn("Paint brush").click();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(sb.x + sb.width / 2 - 25, sb.y + sb.height / 2 - 10, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  const mid = await box();
  ok(Math.abs(mid.x - panned.x + 25) < 2 && Math.abs(mid.y - panned.y + 10) < 2 && await strokes() === 0, "the middle mouse button pans with any tool");
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  await until(async () => Math.abs((await box()).width - panFrom.width / 1.0) > 1 && (await box()).width < panFrom.width * 0.6, "zoomed back out");

  // ================= paint =================
  await hex.fill("#00ff00");
  await btn("Paint brush").click();
  await setRange("Paint size", 10);
  await setRange("Paint softness", 0);
  await setRange("Paint opacity", 100);
  await drag(0.2, 0.5, 0.8, 0.5);
  await until(async () => (await strokes()) === 1, "a paint stroke");
  let paint = await stats("paint");
  ok(paint.n > 20 && paint.rgb && paint.rgb[1] > 240 && paint.rgb[0] < 15 && paint.rgb[2] < 15, `a mouse stroke paints the chosen colour on the paint layer (${paint.n} px, rgb ${paint.rgb})`);
  const basePix = await pixel("base", 0.5, 0.5);
  ok(basePix[3] === 255 && basePix[1] < 200, "…and the picture underneath is untouched");
  ok(await btn("Undo").isEnabled(), "a stroke is an undo step");

  await btn("Paint eraser").click();
  await setRange("Paint size", 24);
  await drag(0.15, 0.5, 0.85, 0.5);
  await until(async () => (await strokes()) === 2, "the eraser stroke");
  paint = await stats("paint");
  ok(paint.n === 0, `the paint eraser takes the paint away again (${paint.n} px left)`);
  ok((await stats("base")).n === 96 * 60, "…and leaves the picture whole");

  // undo and redo, by button and keys
  await btn("Undo").click();
  ok(await strokes() === 1 && (await stats("paint")).n > 20, "Undo brings the paint back");
  await page.keyboard.press("Control+z");
  ok(await strokes() === 0 && (await stats("paint")).n === 0, "Ctrl+Z steps back again");
  await page.keyboard.press("Control+Shift+z");
  ok(await strokes() === 1 && (await stats("paint")).n > 20, "Shift+Ctrl+Z redoes");
  await page.keyboard.press("Control+y");
  ok(await strokes() === 2 && (await stats("paint")).n === 0, "Ctrl+Y redoes");
  await btn("Undo").click();
  // typing in the hex box keeps the undo keys for the box
  await hex.click();
  await page.keyboard.press("Control+z");
  ok(await strokes() === 1, "Ctrl+Z is ignored while typing in a field");
  await btn("Undo").click();
  ok(await strokes() === 0 && await btn("Undo").isDisabled(), "Undo goes back to the start");

  // a new stroke after undo drops the redo list
  await btn("Paint brush").click();
  await drag(0.3, 0.3, 0.7, 0.3);
  await until(async () => (await strokes()) === 1, "a stroke after undo");
  ok(await btn("Redo").isDisabled(), "a new stroke clears Redo");

  // soft brush: the edge is gradual
  await setRange("Paint softness", 100);
  await setRange("Paint size", 20);
  await btn("Undo").click();
  await drag(0.2, 0.6, 0.8, 0.6);
  paint = await stats("paint");
  ok(paint.max > 200 && paint.n > paint.solid, `a soft brush has a feathered edge (${paint.n} painted, ${paint.solid} solid)`);
  await btn("Undo").click();

  // half opacity
  await setRange("Paint softness", 0);
  await setRange("Paint opacity", 50);
  await drag(0.2, 0.6, 0.8, 0.6, 20);
  paint = await stats("paint");
  ok(paint.max > 100 && paint.max < 150, `half opacity lays down about half the paint, however many stamps overlap (max alpha ${paint.max})`);
  await btn("Undo").click();

  // ================= the airbrush =================
  await setRange("Paint opacity", 100);
  await setRange("Paint softness", 60);
  await setRange("Paint size", 24);
  await btn("Airbrush").click();
  const hold = async (ms) => {
    const b = await box();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };
  await hold(150);
  await until(async () => (await strokes()) === 1, "a short airbrush hold");
  const brief = (await stats("paint")).max;
  await btn("Undo").click();
  await hold(1200);
  await until(async () => (await strokes()) === 1, "a long airbrush hold");
  const long = (await stats("paint")).max;
  ok(brief > 0 && long > brief + 40, `holding the airbrush still builds paint up (alpha ${brief} after 150 ms, ${long} after 1.2 s)`);
  await btn("Undo").click();

  // ================= the mask =================
  ok((await stats("mask")).n === 0, "the mask starts empty");
  await btn("Mask brush").click();
  await setRange("Mask brush size", 12);
  await drag(0.3, 0.4, 0.7, 0.4);
  await until(async () => (await maskStrokes()) === 1, "a mask stroke");
  const mask1 = await stats("mask");
  ok(mask1.n > 20 && mask1.max > 240, `a mask stroke is tinted on the mask layer (${mask1.n} px)`);
  ok((await stats("paint")).n === 0 && await strokes() === 0, "…and does not touch the paint");
  const tint = await pixel("mask", 0.5, 0.4);
  ok(tint[2] > tint[0] && tint[3] > 200, "the mask is tinted blue");

  await btn("Invert mask").click();
  ok((await btn("Invert mask").getAttribute("aria-pressed")) === "true" && (await pixel("mask", 0.02, 0.02))[3] > 200 && (await pixel("mask", 0.5, 0.4))[3] === 0, "Invert swaps the painted and unpainted areas");
  await btn("Invert mask").click();
  ok((await pixel("mask", 0.02, 0.02))[3] === 0 && (await pixel("mask", 0.5, 0.4))[3] > 200, "…and swaps them back");

  await btn("Invert mask").click();
  await btn("Clear mask").click();
  ok(await maskStrokes() === 0 && (await btn("Invert mask").getAttribute("aria-pressed")) === "false" && (await stats("mask")).n === 0 && await btn("Clear mask").isDisabled(), "Clear mask takes the strokes away and un-inverts, and is off when there is nothing to clear");
  await btn("Undo").click();
  ok(await maskStrokes() === 1 && (await btn("Invert mask").getAttribute("aria-pressed")) === "true", "…and Undo brings the mask back");
  await btn("Invert mask").click();

  await setRange("Soft edge", 4);
  const soft = async () => (await stored())?.history?.present?.mask?.softness;
  await until(async () => (await soft()) === 4, "the soft edge to be kept");
  const blur = await page.locator("canvas[data-layer=mask]").evaluate((c) => getComputedStyle(c).filter);
  ok(/blur/.test(blur), `Soft edge blurs the mask's tint (${blur})`);

  await btn("Mask eraser").click();
  await setRange("Mask brush size", 24);
  await drag(0.2, 0.4, 0.8, 0.4);
  await until(async () => (await maskStrokes()) === 2, "a mask eraser stroke");
  ok((await stats("mask")).n === 0, "the mask eraser takes the mask away");
  await btn("Undo").click();
  ok((await stats("mask")).n > 20, "…and Undo brings it back");

  await btn("Lasso").click();
  await drag(0.1, 0.1, 0.1, 0.1, 1); // a click is not a shape
  ok(await maskStrokes() === 1, "a lasso click without a shape adds nothing");
  const b = await box();
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.75);
  await page.mouse.down();
  for (const [x, y] of [[0.4, 0.75], [0.4, 0.95], [0.1, 0.95]]) await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 4 });
  await page.mouse.up();
  await until(async () => (await maskStrokes()) === 2, "a lasso shape");
  ok((await pixel("mask", 0.25, 0.85))[3] > 150, "the lasso fills the traced outline");

  // show / hide
  await btn("Show mask").click();
  ok((await btn("Show mask").getAttribute("aria-pressed")) === "false" && (await page.locator("canvas[data-layer=mask]").evaluate((c) => getComputedStyle(c).opacity)) === "0", "Show mask off hides the mask");
  await btn("Show mask").click();
  ok((await page.locator("canvas[data-layer=mask]").evaluate((c) => getComputedStyle(c).opacity)) === "0.5", "…and on shows it again");
  await btn("Show paint").click();
  ok((await page.locator("canvas[data-layer=paint]").evaluate((c) => getComputedStyle(c).visibility)) === "hidden", "Show paint off hides the paint layer");
  await btn("Show paint").click();

  // ================= pen and palm =================
  await btn("Paint brush").click();
  await setRange("Paint size", 14);
  await setRange("Paint opacity", 100);
  const before1 = await strokes();
  const penStroke = (withPalm) =>
    page.evaluate((palm) => {
      const stage = document.querySelector(".refine-stage");
      const r = document.querySelector(".refine-frame").getBoundingClientRect();
      const fire = (type, id, kind, fx, fy, pressure) =>
        stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: kind, isPrimary: id === 7, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pressure, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
      fire("pointerdown", 7, "pen", 0.2, 0.2, 0.2);
      for (let i = 1; i <= 8; i++) fire("pointermove", 7, "pen", 0.2 + i * 0.05, 0.2, 0.2 + i * 0.1);
      if (palm) {
        // a palm resting on the screen while the pen is down
        fire("pointerdown", 9, "touch", 0.5, 0.9, 0.5);
        for (let i = 1; i <= 5; i++) fire("pointermove", 9, "touch", 0.5 + i * 0.05, 0.9, 0.5);
        fire("pointerup", 9, "touch", 0.75, 0.9, 0);
      }
      fire("pointerup", 7, "pen", 0.6, 0.2, 0.8);
    }, withPalm);
  await penStroke(true);
  await until(async () => (await strokes()) === before1 + 1, "the pen stroke");
  await page.waitForTimeout(500);
  const lastStroke = (await stored()).history.present.paint.at(-1);
  const pressures = lastStroke.points.map((p) => p[2]);
  ok(pressures.length >= 6 && Math.max(...pressures) > 0.7 && Math.min(...pressures) >= 0.19 && new Set(pressures).size > 3, `a pen stroke keeps the pressure of each point (${Math.min(...pressures).toFixed(2)}–${Math.max(...pressures).toFixed(2)})`);
  ok(await strokes() === before1 + 1, "a touch while the pen is down is ignored (palm rejection)");
  await page.evaluate(() => {
    const stage = document.querySelector(".refine-stage");
    const r = document.querySelector(".refine-frame").getBoundingClientRect();
    const fire = (type, fx, fy) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "touch", isPrimary: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pressure: 0.5, button: 0, buttons: 1 }));
    fire("pointerdown", 0.3, 0.9);
    for (let i = 1; i <= 5; i++) fire("pointermove", 0.3 + i * 0.05, 0.9);
    fire("pointerup", 0.55, 0.9);
  });
  await until(async () => (await strokes()) === before1 + 2, "a finger stroke");
  await until(async () => (await stored())?.history.present.paint.length === before1 + 2, "the finger stroke to be saved");
  const finger = (await stored()).history.present.paint.at(-1);
  ok(finger.points.every((p) => p[2] === 0), "…while one finger on its own paints, with no pressure");

  // ================= the session is kept =================
  const snapshot = { strokes: await strokes(), masks: await maskStrokes(), paintN: (await stats("paint")).n, maskN: (await stats("mask")).n, color: await hex.inputValue() };
  await until(async () => (await stored())?.history.present.paint.length === snapshot.strokes && (await stored()).history.present.mask.strokes.length === snapshot.masks, "the session to be saved");
  const tools = await page.evaluate(() => JSON.parse(localStorage.getItem("storytime.refine.tools") ?? "null"));
  ok(tools?.color === snapshot.color && tools.size === 14, `the brush settings are kept for the next session (${JSON.stringify(tools)})`);
  await page.reload();
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  await until(async () => (await strokes()) === snapshot.strokes, "the strokes to come back");
  ok(await maskStrokes() === snapshot.masks && (await stats("paint")).n === snapshot.paintN && (await stats("mask")).n === snapshot.maskN, "after a reload the picture, paint and mask are back");
  ok((await hex.inputValue()) === snapshot.color && (await page.getByRole("slider", { name: "Soft edge", exact: true }).inputValue()) === "4", "…with the colour and soft edge");
  ok(await btn("Undo").isEnabled(), "…and the undo history");
  await btn("Undo").click();
  await btn("Undo").click();
  ok(await strokes() === snapshot.strokes - 2, "undo works after a reload");
  await btn("Redo").click();
  await btn("Redo").click();
  ok(await strokes() === snapshot.strokes, "…and redo");

  // ================= Cancel =================
  // 1. the author says no: nothing happens
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await btn("Cancel").click();
  await page.waitForTimeout(300);
  ok(dialogs.length === 1 && dialogs[0] === "Discard your changes?" && /\/refine\//.test(page.url()) && (await stored()) !== null, "Cancel with changes asks “Discard your changes?” and stays when refused");
  page.removeAllListeners("dialog");
  // 2. yes: the session goes and the Illustrate page returns
  const id1 = sessionId();
  page.once("dialog", (d) => d.accept());
  await btn("Cancel").click();
  await page.waitForURL(new RegExp(`/c/${chapterId}/illustrate$`));
  ok(await page.evaluate((id) => localStorage.getItem(`storytime.refine.${id}`), id1) === null, "accepting deletes the session and goes back to the Illustrate page");
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  // 3. a session with no changes: no question
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Refine…" }).click();
  await page.waitForURL(/\/refine\/[a-z0-9]+$/);
  made.push(sessionId());
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  let asked = false;
  page.once("dialog", (d) => { asked = true; d.dismiss(); });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(new RegExp(`/c/${chapterId}/illustrate$`));
  ok(!asked, "Cancel with no changes just goes back (the header's Cancel too)");

  // ================= a missing session =================
  const gone = page.getByText("This Refine session isn’t here any more.");
  await page.goto(`${BASE}/refine/zzzzzzzzzzzz`);
  await gone.waitFor();
  ok((await page.getByRole("link", { name: /Back to StoryTime/ }).getAttribute("href")) === "/", "an unknown session says so, with a link back");
  await page.evaluate(() => localStorage.setItem("storytime.refine.aaaaaaaaaaaa", "{broken"));
  await page.goto(`${BASE}/refine/aaaaaaaaaaaa`);
  await gone.waitFor();
  ok(true, "a damaged session is treated as missing");

  // Old sessions are pruned when a Refine screen opens.
  await page.evaluate(() => localStorage.setItem("storytime.refine.aaaaaaaaaaaa", "{broken"));
  await page.evaluate(() => localStorage.setItem("storytime.refine.bbbbbbbbbbbb", JSON.stringify({ id: "bbbbbbbbbbbb", createdAt: 1, updatedAt: 1 })));
  await page.goto(`${BASE}/refine/zzzzzzzzzzzz`);
  await gone.waitFor();
  ok(await page.evaluate(() => localStorage.getItem("storytime.refine.bbbbbbbbbbbb") === null && localStorage.getItem("storytime.refine.aaaaaaaaaaaa") === null), "opening a Refine screen prunes old and damaged sessions");
  await context.close();

  // ================= phone =================
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  p.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await p.goto(`${BASE}/c/${chapterId}/illustrate`);
  await p.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await p.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  const past = p.locator(".chapter-pictures .picture-tile");
  await past.first().waitFor();
  await past.first().getByRole("button", { name: "More" }).click();
  await past.first().getByRole("menuitem", { name: "Refine…" }).click();
  await p.waitForURL(/\/refine\/[a-z0-9]+$/);
  made.push(/\/refine\/([a-z0-9]+)/.exec(p.url())[1]);
  await p.locator('.refine-stage[data-ready="1"]').waitFor();
  const fit = await p.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { stage: r(".refine-stage"), bar: r(".refine-bar"), tools: r(".refine-panels"), overflowX: document.documentElement.scrollWidth > window.innerWidth, vh: window.innerHeight };
  });
  ok(!fit.overflowX, "at 390 px nothing scrolls sideways");
  ok(fit.stage.top < fit.tools.top && fit.stage.height > 250 && fit.stage.width <= 390, `…the picture comes first and is big enough (${Math.round(fit.stage.width)} x ${Math.round(fit.stage.height)})`);
  ok(fit.bar.bottom <= fit.vh + 1 && fit.bar.top > fit.stage.top, `…and the Undo / Accept / Cancel bar is stuck to the bottom of the screen (bottom ${Math.round(fit.bar.bottom)} of ${fit.vh})`);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const end = await p.evaluate(() => ({ bar: document.querySelector(".refine-bar").getBoundingClientRect().bottom, vh: window.innerHeight, scrollW: document.documentElement.scrollWidth }));
  ok(end.bar <= end.vh + 1 && end.scrollW <= 390, "…also when scrolled to the end of the tools");
  const taps = await p.evaluate(() => [...document.querySelectorAll(".refine-panel button, .refine-bar button")].map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  ok(taps.every((t) => t >= 40), `…and every button is big enough to tap (smallest ${Math.min(...taps)}px)`);
  await phone.close();
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
