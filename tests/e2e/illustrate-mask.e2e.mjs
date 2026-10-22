// Redrawing only a painted part of a picture: "Paint area" in the starting-picture box and "Change part of this…" in a
// picture's ☰ menu open the mask editor; the painted area is shown over the thumbnail, kept across a refresh, uploaded
// as a mask beside the starting picture, put in the workflow (LoadImageMask, SetLatentNoiseMask), and recorded in the
// job log (Info says "painted part only"). Then the same on a phone-sized screen with touch: one finger paints, a
// two-finger pinch does not.
import { comfySettings, launch } from "./browser.mjs";
import { EDIT_FILES, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3558;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Masks", chapter: { title: "The window", body: "The keeper opened the window.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100 });
comfy.setMode({ files: EDIT_FILES }); // an edit model is installed, so the Edit tab can be opened
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

const browser = await launch();
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const prompts = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const uploadedNames = (from = 0) =>
  comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/upload/image").map((c) => /name="image"; filename="([^"]+)"/.exec(String(c.body))?.[1]);
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;

try {
  // ================= desktop, mouse =================
  const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  const queueButton = page.getByRole("button", { name: "Queue", exact: true });
  const tiles = page.locator(".candidates li.picture-tile");
  const thumb = page.getByRole("img", { name: "Starting picture" });
  const editor = page.getByRole("dialog", { name: "Paint the area to change" });
  const paintButton = page.getByRole("button", { name: "Paint area", exact: true });
  const done = editor.getByRole("button", { name: "Done", exact: true });
  const maskLine = page.getByText(/^Redrawing only the painted area \(\d+%\)\.$/);
  const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
  const stroke = async () => {
    const box = await editor.locator(".mask-frame").boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y + 10, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 6 });
    await page.mouse.up();
  };

  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper at a window");
  await queueButton.click();
  await until(async () => (await tiles.count()) === 1 && (await ready()), "the first picture", 150);

  // A new picture: Redraw from this, then Paint area.
  await tiles.first().getByRole("button", { name: "More" }).click();
  const menu = await tiles.first().getByRole("menuitem").allInnerTexts();
  ok(menu.indexOf("Change part of this…") === menu.indexOf("Redraw from this") + 1 && menu.includes("Edit this"), `the ☰ menu has “Change part of this…” right after “Redraw from this” (${menu.join(" | ")})`);
  await tiles.first().getByRole("menuitem", { name: "Redraw from this" }).click();
  await thumb.waitFor();
  ok(await maskLine.count() === 0 && await paintButton.isEnabled(), "a Redraw with no painted area offers Paint area");
  await paintButton.click();
  await editor.waitFor();
  ok(await done.isDisabled(), "the mask editor opens with Done off until something is painted");
  await stroke();
  ok(await done.isEnabled(), "painting a stroke with the mouse turns Done on");
  await done.click();
  await editor.waitFor({ state: "hidden" });
  await maskLine.waitFor();
  ok(await page.getByRole("button", { name: "Change painted area" }).isVisible() && await page.getByRole("button", { name: "Clear painted area" }).isVisible(), "Done shows “Redrawing only the painted area (N%)” with Change and Clear buttons");
  ok(await page.locator("img.start-picture-mask").isVisible(), "…and the painted area is tinted over the thumbnail");
  const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`storytime.illustrate.start.${id}`) ?? "null"), chapterId);
  await until(async () => (await stored())?.mask?.strokes?.length > 0, "the mask to be kept");
  ok(true, "the strokes are kept in the browser with the starting picture");

  // A refresh brings the starting picture and its painted area back.
  await page.reload();
  await thumb.waitFor();
  await maskLine.waitFor();
  ok(true, "after a refresh the painted area is still set");

  // Queue: the mask is uploaded beside the starting picture and put in the workflow.
  const mark = comfy.calls.length;
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper at a window");
  await queueButton.click();
  await until(() => prompts(mark).length === 1, "the job to be sent");
  const wf = prompts(mark)[0];
  const names = uploadedNames(mark);
  const maskName = names.find((n) => /^storytime-mask-.*\.png$/.test(n ?? ""));
  ok(names.length === 2 && names.some((n) => /^storytime-start-/.test(n ?? "")) && maskName, `the starting picture and the mask are uploaded (${names.join(", ")})`);
  const loadMask = nodes(wf, "LoadImageMask")[0];
  ok(loadMask?.inputs.image === maskName && nodes(wf, "SetLatentNoiseMask").length === 1, "the workflow loads the uploaded mask and sets it as the latent's noise mask");
  ok(nodes(wf, "LoadImage").length === 1 && nodes(wf, "ImageCompositeMasked").length === 1, "…and pastes the new picture over the original outside it");
  await until(async () => (await jobs())[0]?.mask === maskName && (await ready()), "the job to be recorded");  ok((await jobs())[0].mask === maskName && (await jobs())[0].source !== null, "the job log keeps the mask's name");

  // Info on the new picture says so.
  await until(async () => (await tiles.count()) >= 1, "the new picture");
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Info" }).click();
  const info = page.locator("dialog[aria-labelledby=picture-info-title]");
  await info.waitFor();
  ok((await info.innerText()).includes("painted part only"), "Info says Area: painted part only");
  await page.keyboard.press("Escape");
  ok((await page.locator(".chapter-pictures").innerText()).includes("painted area"),"the picture's caption says “painted area”");

  // A second click with the same mask joins no new upload; a changed mask would start a new job (the key includes it).
  const again = comfy.calls.length;
  await queueButton.click();
  await until(() => prompts(again).length === 1, "the second job");
  ok(uploadedNames(again).length === 0, "another job with the same painted area uploads nothing again");

  // Change painted area opens the editor with the strokes; Clear painted area removes it.
  await page.getByRole("button", { name: "Change painted area" }).click();
  await editor.waitFor();
  ok(await done.isEnabled(), "Change painted area reopens the editor with the strokes already there");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Clear painted area" }).click();
  await paintButton.waitFor();
  ok(await maskLine.count() === 0 && (await stored())?.mask === undefined, "Clear painted area goes back to Paint area and forgets the strokes");

  // The Edit tab says the painted area is only for Redraw.
  await paintButton.click();
  await editor.waitFor();
  await stroke();
  await done.click();
  await maskLine.waitFor();
  await page.getByRole("tab", { name: "Edit" }).click();
  await page.getByText("The painted area is only used by Redraw for now.").waitFor();
  ok(await page.locator("img.start-picture-mask").count() === 0, "on the Edit tab a note says the painted area is only used by Redraw for now, and it is not tinted");

  // Changing the starting picture clears the painted area.
  await page.getByRole("tab", { name: "Redraw" }).click();
  await page.getByRole("button", { name: "Clear starting picture" }).click();
  await thumb.waitFor({ state: "detached" });
  ok((await stored()) === null, "clearing the starting picture forgets the painted area too");

  // “Change part of this…” from the ☰ menu: starts from the picture, Redraw, and opens the editor.
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Change part of this…" }).click();
  await editor.waitFor();
  await thumb.waitFor();
  ok(await page.getByRole("tab", { name: "Redraw" }).getAttribute("aria-selected") === "true", "“Change part of this…” starts a Redraw from the picture and opens the mask editor");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  ok(await maskLine.count() === 0 && await paintButton.isVisible(), "cancelling leaves no painted area");

  // The viewer closes first: no two modals stacked.
  await tiles.first().locator("a").click();
  const viewer = page.getByRole("dialog", { name: "Picture viewer" });
  await viewer.waitFor();
  await viewer.getByRole("button", { name: "More" }).click();
  await viewer.getByRole("menuitem", { name: "Change part of this…" }).click();
  await editor.waitFor();
  ok(await viewer.count() === 0 || !(await viewer.isVisible()), "from the full-size viewer the viewer closes before the mask editor opens");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await context.close();

  // ================= phone, touch =================
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  p.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  const cdp = await phone.newCDPSession(p);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const pEditor = p.getByRole("dialog", { name: "Paint the area to change" });
  const pDone = pEditor.getByRole("button", { name: "Done", exact: true });

  await p.goto(`${BASE}/c/${chapterId}/illustrate`);
  await p.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await p.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  const past = p.locator(".chapter-pictures .picture-tile");
  await past.first().waitFor();
  await past.first().getByRole("button", { name: "More" }).click();
  await past.first().getByRole("menuitem", { name: "Change part of this…" }).click();
  await pEditor.waitFor();
  ok(await pDone.isDisabled(), "on a phone the mask editor opens with nothing painted");
  const fits = await p.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const stage = r(".mask-stage"), bar = r(".mask-bar");
    return { stage, bar, overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(fits.bar.bottom <= 844 + 1 && fits.stage.height > 200 && !fits.overflowX, `the bar fits below the picture on a phone (stage ${Math.round(fits.stage.height)}px high, bar ${Math.round(fits.bar.height)}px)`);

  const box = await pEditor.locator(".mask-frame").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // two fingers moving apart: a pinch, not paint
  await touch("touchStart", [[cx - 20, cy], [cx + 20, cy]]);
  for (let i = 1; i <= 6; i++) await touch("touchMove", [[cx - 20 - i * 8, cy], [cx + 20 + i * 8, cy]]);
  await touch("touchEnd", []);
  await p.waitForTimeout(200);
  ok(await pDone.isDisabled(), "a two-finger pinch does not paint");
  // one finger: paints
  const y = box.y + box.height * 0.5;
  await touch("touchStart", [[box.x + box.width * 0.3, y]]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [[box.x + box.width * (0.3 + i * 0.05), y + i * 2]]);
  await touch("touchEnd", []);
  await until(() => pDone.isEnabled(), "Done to turn on");
  ok(await pDone.isEnabled(), "one finger paints a stroke (Done is on)");
  await pDone.click();
  await pEditor.waitFor({ state: "hidden" });
  const pLine = p.getByText(/^Redrawing only the painted area \(\d+%\)\.$/);
  await pLine.waitFor();
  const layout = await p.evaluate(() => {
    const box = document.querySelector(".start-picture")?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".start-mask button")].map((b) => Math.round(b.getBoundingClientRect().height));
    return { right: box?.right ?? 0, buttons, overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(layout.right <= 390 && !layout.overflowX && layout.buttons.length === 2 && layout.buttons.every((h) => h >= 40), `at 390px the starting-picture box fits and its buttons are tall enough to tap (${layout.buttons.join(", ")}px)`);
  await phone.close();
} finally {
  // the starting picture and its painted area are kept per browser only; nothing else was left behind
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
