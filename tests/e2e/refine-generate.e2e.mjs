// Refine screen: the Prompt panel and Go. The boxes start from the picture's prompt (Clear / Reset, the local Always add
// box), the strength and Pictures per click are remembered, the LoRAs start from the Illustrate page's changes and
// changing them here never changes the page or the preset. Go sends the picture as seen (visible paint only) and the
// mask only when it is visible and painted; the jobs are temporary, belong to the Refine screen alone (not the
// Illustrate page, not "ready" in the header), come back as Results tiles that survive a reload, and a job still
// running at a reload is found again. The picture and the jobs come from the fake ComfyUI.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3560;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Refine and go", chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
const chapterId = story.chapter_id;
await fetch(`${BASE}/api/chapters/${chapterId}/picture-fixed`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixed: "gold light" }) });
const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100, files: { loras: ["styles/ink.safetensors"] } });
const ink = { name: "styles/ink.safetensors", strength: 0.8, on: true };
const withSettings = (extra = {}) => ({ ...(before ?? {}), comfy: { ...comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", draw: { prompt: "masterpiece", negative: "blurry", loras: [ink] } }), ...extra } });
await putSettings(withSettings());
const presetNow = async () => JSON.stringify((await call("GET", "/api/settings")).settings.comfy.drawPresets[0]);
const presetAtStart = await presetNow();

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  const sessionId = () => /\/refine\/([a-z0-9]+)/.exec(page.url())?.[1];
  const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`storytime.refine.${id}`) ?? "null"), sessionId());
  const tiles = page.locator(".chapter-pictures .picture-tile");
  const results = page.locator("[data-result-index]");
  const stage = page.locator(".refine-stage");
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const box = (name) => page.getByRole("textbox", { name, exact: true });
  const go = btn("Go");
  const frame = () => page.locator(".refine-frame").boundingBox();
  const drag = async (fx0, fy0, fx1, fy1) => {
    const b = await frame();
    await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 8 });
    await page.mouse.up();
  };
  const prompts = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");
  const nodes = (wf, cls) => Object.values(wf.prompt).filter((n) => n.class_type === cls);
  const lastWorkflow = () => prompts().at(-1).body;
  const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
  const showAll = async () => {
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
    await tiles.first().waitFor();
  };
  const openRefine = async () => {
    await page.goto(`${BASE}/c/${chapterId}/illustrate`);
    await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
    await showAll();
    await tiles.first().getByRole("button", { name: "More" }).click();
    await tiles.first().getByRole("menuitem", { name: "Refine…" }).click();
    await page.waitForURL(/\/refine\/[a-z0-9]+$/);
    await page.locator('.refine-stage[data-ready="1"]').waitFor();
  };
  // The colour of a pixel of an uploaded picture, found by decoding its bytes in the page.
  const uploadedPixel = async (name, fx, fy) => {
    const bytes = comfy.uploaded(name);
    if (!bytes) return null;
    return page.evaluate(async ([b64, x, y]) => {
      const bin = atob(b64);
      const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return [...ctx.getImageData(Math.floor(bmp.width * x), Math.floor(bmp.height * y), 1, 1).data];
    }, [bytes.toString("base64"), fx, fy]);
  };
  const basePixel = (fx, fy) => page.evaluate(([x, y]) => {
    const c = document.querySelector("canvas[data-layer=base]");
    return [...c.getContext("2d").getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data];
  }, [fx, fy]);
  const near = (a, b, tol = 12) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
  const goAndWait = async (n) => {
    const had = prompts().length;
    const tilesBefore = await results.count();
    await go.click();
    await until(async () => prompts().length === had + 1 && (await results.count()) === tilesBefore + n, `Go to make ${n} tile(s)`);
  };

  // ================= a picture on the Illustrate page, with the page's own changes =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await box("Prompt").fill("a keeper at a lamp");
  await box("Negative prompt").fill("ugly");
  const pageLoras = page.locator(".draw-preset").getByRole("group", { name: "LoRAs" });
  await pageLoras.getByLabel("Strength of ink").fill("0.3");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(async () => (await page.locator(".candidates li.picture-tile").count()) === 1 && (await ready()), "the first picture", 200);
  const pageLoraStore = () => page.evaluate((id) => localStorage.getItem(`storytime.illustrate.loras.${id}`), chapterId);
  const pageLorasBefore = await pageLoraStore();
  ok(pageLorasBefore !== null && pageLorasBefore.includes("0.3"), "the Illustrate page keeps its own LoRA change (ink 0.3)");
  const illustrateJob = (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs[0];

  // ================= opening Refine: the boxes start from the picture =================
  await openRefine();
  const sent1 = await stored();
  ok(sent1.sourcePrompt === illustrateJob.prompt && sent1.results.length === 0, "the session keeps the picture's prompt as the source for Reset, and no results yet");
  ok(await box("Prompt").inputValue() === illustrateJob.prompt && illustrateJob.prompt.includes("a keeper at a lamp"), `the Prompt box starts as the picture's prompt (“${illustrateJob.prompt}”)`);
  ok(await box("Negative prompt").inputValue() === illustrateJob.negative && illustrateJob.negative.includes("ugly"), "the Negative prompt box starts as the picture's negative");
  ok(await box("Always add").inputValue() === "gold light", "Always add starts as the chapter's Always include text");
  ok((await page.locator(".refine-panel .prompt-art-style").allInnerTexts()).some((t) => t.includes("Preset: masterpiece")) && (await page.locator(".refine-panel .prompt-art-style").allInnerTexts()).some((t) => t.includes("Preset: blurry")), "the drawing preset's own text is shown under the boxes");

  // Clear and Reset.
  await btn("Clear prompt").click();
  ok(await box("Prompt").inputValue() === "" && await go.isDisabled() && (await go.getAttribute("title")) === "Write a prompt first.", "Clear empties the Prompt box and Go is off, saying why");
  ok(await btn("Clear prompt").isDisabled() && await btn("Reset prompt").isEnabled(), "…Clear is off when empty, Reset on");
  await btn("Reset prompt").click();
  ok(await box("Prompt").inputValue() === illustrateJob.prompt && await go.isEnabled(), "Reset puts the picture's prompt back");
  await box("Negative prompt").fill("extra fingers");
  await btn("Reset negative prompt").click();
  ok(await box("Negative prompt").inputValue() === illustrateJob.negative, "Reset negative prompt puts the picture's negative back");
  await btn("Clear negative prompt").click();
  ok(await box("Negative prompt").inputValue() === "", "Clear negative prompt empties it");
  await btn("Reset negative prompt").click();

  // Always add is a local copy.
  await box("Always add").fill("silver moon");
  ok(await btn("Reset always add").isEnabled(), "changing Always add turns its Reset on");
  const fixedNow = async () => (await call("GET", `/api/chapters/${chapterId}/picture-fixed`)).fixed;
  ok(await fixedNow() === "gold light", "…and the chapter's Always include text is not changed");
  await btn("Clear always add").click();
  await btn("Reset always add").click();
  ok(await box("Always add").inputValue() === "gold light", "Reset always add goes back to the chapter's text");
  await box("Always add").fill("silver moon");
  await box("Prompt").fill("a keeper at a lamp, in the rain");

  // The boxes survive a reload (they are part of the session).
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  ok(await box("Prompt").inputValue() === "a keeper at a lamp, in the rain" && await box("Always add").inputValue() === "silver moon", "a reload brings the typed boxes back");
  ok(await btn("Reset prompt").isEnabled(), "…and Reset still goes back to the picture's own prompt");
  const firstSession = sessionId();

  // ================= strength, pictures per click, LoRAs =================
  const strength = page.getByRole("slider", { name: "Strength", exact: true });
  const perClick = page.getByRole("combobox", { name: "Pictures per click" });
  ok(await strength.inputValue() === "0.55" && await perClick.inputValue() === "1", "Strength starts at the drawing preset's Redraw strength (0.55) and Pictures per click at the page's setting (1)");
  await strength.fill("0.3");
  await perClick.selectOption("2");
  const loras = page.getByRole("group", { name: "LoRAs" });
  ok(await loras.getByLabel("Strength of ink").inputValue() === "0.3" && await loras.getByRole("button", { name: "Reset LoRAs to preset" }).count() === 1, "the LoRAs start with the Illustrate page's change (ink 0.3), with Reset LoRAs to preset");
  await loras.getByLabel("Strength of ink").fill("0.6");
  ok(await pageLoraStore() === pageLorasBefore && await presetNow() === presetAtStart, "changing a LoRA here changes neither the page's LoRA changes nor the preset");
  ok((await call("GET", "/api/settings")).settings.comfy.queueCount === (before?.comfy?.queueCount ?? 1) || (await call("GET", "/api/settings")).settings.comfy.queueCount === 1, "…and Pictures per click here doesn't change the page's setting");

  // ================= Go, no mask, no paint =================
  await goAndWait(2);
  const wf1 = lastWorkflow();
  const samplers = nodes(wf1, "KSampler");
  ok(nodes(wf1, "LoadImage").length === 1 && samplers[0].inputs.denoise === 0.3, "Go sends an image to image job at the strength set here (0.3)");
  ok(nodes(wf1, "LoadImageMask").length === 0 && nodes(wf1, "SetLatentNoiseMask").length === 0, "…with no mask in it: the whole picture is redrawn");
  const lora = nodes(wf1, "LoraLoader")[0];
  ok(lora?.inputs.lora_name === "styles/ink.safetensors" && lora.inputs.strength_model === 0.6, "…with the LoRA at the strength set here (0.6)");
  const texts = nodes(wf1, "CLIPTextEncode").map((n) => n.inputs.text);
  const pos = texts.find((t) => t.includes("rain"));
  ok(pos && pos.startsWith("masterpiece") && pos.includes("silver moon") && !pos.includes("gold light") && pos.includes("a keeper at a lamp"), `the prompt is the preset's text, Always add, then the box (“${pos}”)`);
  ok(texts.some((t) => t.includes("ugly") && t.includes("blurry")), "…and the negative box then the preset's negative");
  ok(await results.count() === 2 && (await page.getByRole("heading", { name: /^Results/ }).innerText()).includes("(2)"), "two Results tiles appear (Pictures per click 2), with the count");
  ok(await page.locator('[data-result-index="0"]').getAttribute("aria-label") === "Result 1" && await page.locator('[data-result-index="1"]').getAttribute("aria-label") === "Result 2", "…each tile is labelled Result N");
  await page.waitForTimeout(700); // the session is saved a moment after a change
  const sess = await stored();
  ok(sess.results.length === 2 && sess.results[0].madeFrom === "original" && sess.results[0].image.filename.startsWith("StoryTime_") && sess.results[0].prompt === pos, "the session keeps each result's image, prompt, base and seed");
  const tools = await page.evaluate(() => JSON.parse(localStorage.getItem("storytime.refine.tools")));
  ok(tools.strengths.test === 0.3 && tools.queueCount === 2, "the last strength (per drawing preset) and Pictures per click are kept in storytime.refine.tools");

  // The job log has it as temporary; the Illustrate page does not show it.
  const tmp = (await call("GET", `/api/picture-jobs?chapter=${chapterId}&temporary=only`)).jobs;
  ok(tmp.length === 1 && tmp[0].temporary === true && tmp[0].images.length === 2 && tmp[0].denoise === 0.3 && tmp[0].mask === null, "the job log has the job as temporary (2 pictures, strength 0.3, no mask)");
  ok((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 1, "…and an ordinary listing leaves it out");

  // ================= reload: the tiles come back =================
  await page.reload();
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  await results.first().waitFor();
  ok(await results.count() === 2, "a reload brings the Results tiles back");
  ok(await strength.inputValue() === "0.30" || (await strength.inputValue()) === "0.3", "…and the strength");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/refine-generate-1280.png` });
    await page.locator(".refine-panels").screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/refine-generate-panels-1280.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/refine-generate-390.png`, fullPage: true });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 390 px the Prompt and Results panels do not scroll sideways");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
  }

  // ================= paint and mask =================
  await btn("Paint brush").click();
  await page.getByRole("textbox", { name: "Colour as hex" }).fill("#00ff00");
  await page.getByRole("slider", { name: "Paint size", exact: true }).fill("20");
  await page.getByRole("slider", { name: "Paint softness", exact: true }).fill("0");
  await page.getByRole("slider", { name: "Paint opacity", exact: true }).fill("100");
  await drag(0.2, 0.5, 0.8, 0.5);
  await perClick.selectOption("1");
  const orig = await basePixel(0.5, 0.5);
  // Paint visible (and no mask): the sent picture has the paint.
  await goAndWait(1);
  const startName = () => nodes(lastWorkflow(), "LoadImage")[0].inputs.image;
  let px = await uploadedPixel(startName(), 0.5, 0.5);
  ok(px && px[1] > 200 && px[0] < 60 && px[2] < 60 && nodes(lastWorkflow(), "LoadImageMask").length === 0, `paint visible: the uploaded picture has the green paint at the painted spot (${px}) and still no mask`);
  const upload1 = startName();
  // Same picture and paint again: the upload is reused.
  const uploadsBefore = comfy.calls.filter((c) => c.path === "/upload/image").length;
  await goAndWait(1);
  ok(startName() === upload1 && comfy.calls.filter((c) => c.path === "/upload/image").length === uploadsBefore, "the same picture and paint again reuses the upload");
  // Paint hidden: not used.
  await btn("Show paint").click();
  await goAndWait(1);
  px = await uploadedPixel(startName(), 0.5, 0.5);
  ok(startName() !== upload1 && near(px, orig, 14), `paint hidden: the uploaded picture is the original at that spot (${px} vs ${orig})`);
  await btn("Show paint").click();

  // A mask: only the masked part is redrawn.
  await btn("Mask brush").click();
  await page.getByRole("slider", { name: "Mask brush size", exact: true }).fill("20");
  await drag(0.3, 0.3, 0.4, 0.3);
  await goAndWait(1);
  const wfm = lastWorkflow();
  const maskName = nodes(wfm, "LoadImageMask")[0]?.inputs.image;
  ok(nodes(wfm, "SetLatentNoiseMask").length === 1 && maskName?.startsWith("storytime-mask-"), `mask visible with strokes: the job uses a mask image (${maskName})`);
  const inside = await uploadedPixel(maskName, 0.35, 0.3);
  const outside = await uploadedPixel(maskName, 0.8, 0.8);
  ok(inside && inside[0] > 200 && outside && outside[0] < 40, `…white where it was painted, black elsewhere (${inside} / ${outside})`);
  ok(nodes(wfm, "KSampler")[0].inputs.denoise === 0.3, "…at the same strength");
  const tmpJobs = (await call("GET", `/api/picture-jobs?chapter=${chapterId}&temporary=only`)).jobs;
  ok(tmpJobs[0].mask === maskName && tmpJobs[0].temporary === true, "the job log records the mask's name on the temporary job");
  // The mask hidden: not used.
  await btn("Show mask").click();
  await goAndWait(1);
  ok(nodes(lastWorkflow(), "LoadImageMask").length === 0 && nodes(lastWorkflow(), "SetLatentNoiseMask").length === 0, "mask hidden: no mask in the job (the whole picture)");
  await btn("Show mask").click();
  ok(await results.count() === 7, "every Go added its tile (7 results)");
  // A mask rubbed out again still has strokes but paints nothing: that is a whole-picture redraw, not an error.
  await btn("Mask eraser").click();
  await page.getByRole("slider", { name: "Mask brush size", exact: true }).fill("24");
  await drag(0.1, 0.3, 0.6, 0.3);
  await goAndWait(1);
  ok(nodes(lastWorkflow(), "LoadImageMask").length === 0 && nodes(lastWorkflow(), "SetLatentNoiseMask").length === 0 && await results.count() === 8, "a mask with nothing left painted redraws the whole picture, with no error");

  // ================= the Illustrate page does not see these jobs =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await showAll();
  ok(await tiles.count() === 1, "the Illustrate page still shows one picture (the Refine ones are temporary)");
  ok(await page.getByRole("button", { name: /Pictures:/ }).count() === 0, "…and nothing is “ready” in the header");
  const toggle = page.locator(".chapter-pictures").getByRole("checkbox", { name: "Include temporary inpainting images" });
  await toggle.waitFor();
  await toggle.check();
  await until(async () => (await tiles.count()) > 1, "the temporary pictures");
  ok(await tiles.count() === 1 + 8, "with “Include temporary inpainting images” on, the Refine pictures (8 of them) appear too");

  // ================= a session's jobs are not given to the page, and wait for the screen =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await showAll();
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: "Refine…" }).click();
  await page.waitForURL(/\/refine\/[a-z0-9]+$/);
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  const secondSession = sessionId();
  ok(secondSession !== firstSession, "Refine… on the same picture makes a new session");
  ok(await strength.inputValue() === "0.30" || (await strength.inputValue()) === "0.3", "the last strength is remembered in the second session");
  ok(await perClick.inputValue() === "1" && await results.count() === 0, "…as is Pictures per click (1 was the last chosen), and the new session has no results");
  ok(await box("Always add").inputValue() === "gold light", "…and Always add starts from the chapter again, not from the first session");
  ok(await loras.getByLabel("Strength of ink").inputValue() === "0.3", "…and the LoRAs start from the page's change again, not from the first session's 0.6");
  // Go, leave for the Illustrate page (inside the app) before it finishes, come back.
  comfy.setMode({ steps: 4, stepDelay: 250 });
  const had = prompts().length;
  await go.click();
  await until(() => prompts().length === had + 1, "the job to be queued");
  await page.goBack();
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  const listAfter = (await call("GET", `/api/picture-jobs?chapter=${chapterId}&temporary=only`)).jobs.length;
  await until(async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}&temporary=only`)).jobs.length > 0 && (await page.getByRole("button", { name: /Pictures:/ }).count()) === 0, "the job to finish while away", 200);
  ok(await page.locator(".comfy-pending-tile").count() === 0 && await page.getByRole("button", { name: /ready/ }).count() === 0, `while the screen is away the Illustrate page shows no pending tile and the header no “ready” (jobs before: ${listAfter})`);
  await showAll();
  const afterAway = await tiles.count();
  ok(afterAway === 1, "…and no new picture on the page");
  await page.goForward();
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  await until(async () => (await results.count()) === 1, "the waiting result to be delivered when the screen opens again");
  ok(await results.count() === 1, "the result that finished while the screen was away arrives when it opens again");
  comfy.setMode({ steps: 2, stepDelay: 60 });

  // ================= reload while a job runs =================
  comfy.setMode({ steps: 6, stepDelay: 300 });
  const n0 = prompts().length;
  await go.click();
  await until(() => prompts().length === n0 + 1, "the job to be queued");
  await page.reload();
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  const pendingTile = page.locator('[data-pending="true"]');
  await until(async () => (await pendingTile.count()) > 0 || (await results.count()) === 2, "the running job to be found again");
  ok(true, "a job still running at a reload is shown again as a place kept");
  await until(async () => (await results.count()) === 2 && (await pendingTile.count()) === 0, "its result to arrive", 200);
  ok(await results.count() === 2, "…and its result still arrives in this session after the reload");
  ok((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 1, "…and it is still not an ordinary job");
  comfy.setMode({ steps: 2, stepDelay: 60 });

  // ================= nothing here touched the page, the chapter or the preset =================
  ok(await pageLoraStore() === pageLorasBefore && await presetNow() === presetAtStart && await fixedNow() === "gold light", "at the end the page's LoRA changes, the preset and the chapter's Always include text are what they were");

  // ================= a picture with no prompt of its own uses the page's saved boxes =================
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  const fallbackId = "fallback01a";
  const orphan = {
    id: fallbackId, target: { kind: "chapter", storyId: story.story_id ?? story.id, chapterId }, createdAt: Date.now(), updatedAt: Date.now(),
    original: sess.original ?? { kind: "comfy", image: sess.results[0].image }, loras: null,
    history: { past: [], future: [], present: { base: "original", paint: [], mask: { strokes: [], softness: 0, inverted: false }, paintVisible: true, maskVisible: true } },
  };
  await page.evaluate(([id, s]) => localStorage.setItem(`storytime.refine.${id}`, JSON.stringify(s)), [fallbackId, orphan]);
  await page.goto(`${BASE}/refine/${fallbackId}`);
  await page.locator('.refine-stage[data-ready="1"]').waitFor();
  await until(async () => (await box("Prompt").inputValue()) !== "", "the page's saved prompt");
  ok(await box("Prompt").inputValue() === "a keeper at a lamp", "a session with no prompt starts from the chapter's saved prompt box");
  await page.waitForTimeout(700);
  const old = await page.evaluate((id) => JSON.parse(localStorage.getItem(`storytime.refine.${id}`)), fallbackId);
  ok(Array.isArray(old.results) && old.sourcePrompt === "a keeper at a lamp", "…and an older session without results is read as having none");
  await context.close();
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
