// Refine screen: Accept. It keeps what the author sees. With nothing changed (or only hidden paint) it just leaves.
// With an applied result and no visible paint, that result becomes a pinned picture on the Illustrate page. With visible
// paint, the flattened picture is uploaded to ComfyUI's input folder and recorded as a new (not temporary) pinned
// picture. A picture of the job log is trashed (rejected) when replaced; a saved header is left alone. Accept is off
// while a result is on show; an error keeps the session, and trying again does not record the picture twice.
import { comfySettings, launch } from "./browser.mjs";
import { makePng, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3564;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 40, startDelay: 60 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors" }) });

const stories = [];
let counter = 0;
/** A story with one chapter, and (unless `original` is false) a logged picture for it as the Refine original. */
async function fresh(title, { original = true, moment = "end" } = {}) {
  const s = await call("POST", "/api/stories", { title, chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
  stories.push(s.story_id ?? s.id);
  const chapterId = s.chapter_id;
  const storyId = s.story_id ?? s.id;
  let job = null;
  const file = `StoryTime_9${++counter}_5.png`;
  if (original) {
    job = await call("POST", "/api/picture-jobs", {
      chapter_id: chapterId, prompt_id: `orig-${counter}-${Date.now()}`, prompt: "a keeper at a lamp", negative: "ugly", checkpoint: "fake_sdxl_a.safetensors",
      width: 96, height: 60, seed: 5, count: 1, moment, images: [{ filename: file, subfolder: "", type: "output" }], unseen: false,
    });
  }
  return { storyId, chapterId, job, file };
}
const jobsOf = async (chapterId) => (await call("GET", `/api/picture-jobs?chapter=${chapterId}&temporary=1&limit=200`)).jobs;

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

  const stage = page.locator(".refine-stage");
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const box = (name) => page.getByRole("textbox", { name, exact: true });
  const slider = (name) => page.getByRole("slider", { name, exact: true });
  const tray = page.locator("[data-result-index]");
  const tileAt = (i) => page.locator(`[data-result-index="${i}"] button`);
  const frame = () => page.locator(".refine-frame").boundingBox();
  const drag = async (fx0, fy0, fx1, fy1) => {
    const b = await frame();
    await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 8 });
    await page.mouse.up();
  };
  const paintGreen = async () => {
    await btn("Paint brush").click();
    await page.getByRole("textbox", { name: "Colour as hex" }).fill("#00ff00");
    await slider("Paint size").fill("20");
    await drag(0.2, 0.5, 0.8, 0.5);
  };
  const sessionKey = (id) => `storytime.refine.${id}`;
  const stored = (id) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), sessionKey(id));
  const uploads = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/upload/image").length;
  const ready = () => page.locator('.refine-stage[data-ready="1"]').waitFor();
  const illustrateUrl = (chapterId) => new RegExp(`/c/${chapterId}/illustrate$`);
  const uploadedPixel = (name, fx, fy) => {
    const bytes = comfy.uploaded(name);
    if (!bytes) return null;
    return page.evaluate(async ([b64, x, y]) => {
      const arr = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([arr], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return [...ctx.getImageData(Math.floor(bmp.width * x), Math.floor(bmp.height * y), 1, 1).data];
    }, [bytes.toString("base64"), fx, fy]);
  };
  const near = (a, b, tol = 14) => a && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
  let nth = 0;
  /** Puts a Refine session on a ComfyUI picture in the browser's storage and opens it. */
  const openSession = async (ctx, original, target = { kind: "chapter", storyId: ctx.storyId, chapterId: ctx.chapterId }) => {
    const id = `acc${++nth}x${Date.now().toString(36)}`;
    await page.goto(`${BASE}/c/${ctx.chapterId}/illustrate`);
    await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
    const now = Date.now();
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [sessionKey(id), {
      id, target, createdAt: now, updatedAt: now, original, prompt: "a keeper at a lamp", negative: "ugly", sourcePrompt: "a keeper at a lamp", sourceNegative: "ugly", sourceAlways: "", loras: null, results: [],
      history: { past: [], future: [], present: { base: "original", paint: [], mask: { strokes: [], softness: 0, inverted: false }, paintVisible: true, maskVisible: true } },
    }]);
    await page.goto(`${BASE}/refine/${id}`);
    await ready();
    return id;
  };
  const comfyOriginal = (file) => ({ kind: "comfy", image: { filename: file, subfolder: "", type: "output" } });
  const tilesPage = page.locator(".chapter-pictures .picture-tile");
  const shownFiles = () => tilesPage.locator("img").evaluateAll((imgs) => imgs.map((i) => new URL(i.src).searchParams.get("filename") ?? i.src));
  const view = (name) => page.getByRole("group", { name: "Show" }).getByRole("button", { name: new RegExp(`^${name}`) });
  const waitIllustrate = async (ctx) => {
    await page.waitForURL(illustrateUrl(ctx.chapterId));
    await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  };

  // ================= 1. nothing changed: it just leaves =================
  {
    const ctx = await fresh("Accept nothing");
    const id = await openSession(ctx, comfyOriginal(ctx.file));
    ok(await btn("Keep picture").isEnabled() && (await btn("Keep picture").getAttribute("title")) === "Keep this picture and go back", "Accept is on once the picture is loaded");
    const jobsBefore = (await jobsOf(ctx.chapterId)).length;
    const up = uploads();
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    const jobs = await jobsOf(ctx.chapterId);
    ok(jobs.length === jobsBefore && jobs[0].marks[0] === null && uploads() === up, "with nothing changed Accept leaves: nothing recorded, uploaded or trashed");
    ok((await stored(id)) === null, "…and the session is gone");

    // paint, then hide the paint: the hidden paint is discarded, so it is the same as nothing changed.
    const id2 = await openSession(ctx, comfyOriginal(ctx.file));
    await paintGreen();
    await btn("Show paint").click();
    ok((await btn("Show paint").getAttribute("aria-pressed")) === "false", "(the paint is hidden)");
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    const jobs2 = await jobsOf(ctx.chapterId);
    ok(jobs2.length === jobsBefore && jobs2[0].marks[0] === null && uploads() === up && (await stored(id2)) === null, "hidden paint is discarded: Accept just leaves (no upload, no new picture, the original is not trashed)");
  }

  // ================= 2. an applied result, no visible paint =================
  {
    const ctx = await fresh("Accept a result");
    const id = await openSession(ctx, comfyOriginal(ctx.file));
    await page.getByRole("combobox", { name: "Pictures per click" }).selectOption("2");
    await btn("Go").click();
    await until(async () => (await tray.count()) === 2, "two results");
    await until(async () => (await jobsOf(ctx.chapterId)).length === 2, "the Refine job in the log");
    await tileAt(1).click();
    ok(await btn("Keep picture").isDisabled() && (await btn("Keep picture").getAttribute("title")) === "Apply or deselect the result first", "Accept is off while a result is on show, and says why");
    await tileAt(1).click();
    ok(await btn("Keep picture").isEnabled(), "…and on again when it is let go");
    await tileAt(1).click();
    await until(async () => (await stage.getAttribute("data-preview-ready")) === "1", "the result to load");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await until(async () => (await stage.getAttribute("data-previewing")) === "false", "Apply");
    await page.waitForTimeout(700);
    const applied = (await stored(id)).results[1].image;
    const up = uploads();
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    const jobs = await jobsOf(ctx.chapterId);
    const refineJob = jobs.find((j) => j.temporary);
    const origJob = jobs.find((j) => !j.temporary);
    const idx = refineJob.images.findIndex((i) => i.filename === applied.filename);
    ok(jobs.length === 2 && refineJob.marks[idx] === "pinned" && refineJob.marks[1 - idx] === null, `the applied result is pinned in its temporary job (${applied.filename}); the other result is left alone`);
    ok(origJob.marks[0] === "rejected" && uploads() === up, "the original job picture is trashed (rejected); nothing was uploaded");
    await until(async () => (await tilesPage.count()) === 1, "the pinned picture");
    ok((await shownFiles()).join() === applied.filename, "the Illustrate page shows the accepted picture in Pinned & new without the temporary switch, and nothing else");
    await view("All").click();
    ok((await shownFiles()).join() === applied.filename, "All shows it too; the original and the other result are not there");
    await view("Trashed").click();
    await until(async () => (await tilesPage.count()) === 1, "the trashed picture");
    ok((await shownFiles()).join() === ctx.file, "the original is in Trashed (rejected)");
    ok((await stored(id)) === null, "the session is gone");
  }

  // ================= 3. visible paint =================
  {
    const ctx = await fresh("Accept painted");
    const id = await openSession(ctx, comfyOriginal(ctx.file));
    await paintGreen();
    const up = uploads();
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    ok(uploads() === up + 1, "Accept uploaded one picture to ComfyUI");
    const jobs = await jobsOf(ctx.chapterId);
    const fresh1 = jobs.find((j) => j.images[0].type === "input");
    ok(jobs.length === 2 && fresh1 && fresh1.temporary === false && fresh1.count === 1 && fresh1.images.length === 1, "a new job (not temporary) is in the log for it, with the picture in the input folder");
    const file = fresh1.images[0];
    ok(file.filename.startsWith("storytime-refine-accepted-") && file.subfolder === "", `…its file is the upload (${file.filename})`);
    ok(near(await uploadedPixel(file.filename, 0.5, 0.5), [0, 255, 0]), "…whose pixels contain the painted colour where the author painted");
    ok(!near(await uploadedPixel(file.filename, 0.05, 0.9), [0, 255, 0]), "…and not elsewhere");
    ok(fresh1.prompt === "a keeper at a lamp" && fresh1.negative === "ugly" && fresh1.checkpoint === "Refine (painted)" && fresh1.moment === "end" && fresh1.width === 96 && fresh1.height === 60 && fresh1.source === `comfy:${ctx.file}`, `…with the picture's prompt, negative, size, the original's moment (end) and source (${fresh1.source})`);
    ok(fresh1.marks[0] === "pinned" && jobs.find((j) => j !== fresh1).marks[0] === "rejected", "…it is pinned and the original is trashed");
    await until(async () => (await tilesPage.count()) === 1, "the pinned picture");
    const src = await tilesPage.locator("img").first().getAttribute("src");
    ok(new URL(src).searchParams.get("type") === "input" && src.includes(file.filename), "the Illustrate page shows the input-folder picture in Pinned & new");
    const loaded = await tilesPage.locator("img").first().evaluate((i) => i.complete && i.naturalWidth > 0);
    ok(loaded && (await page.getByText("ComfyUI no longer has this picture").count()) === 0, "…and ComfyUI serves it");
    await tilesPage.first().getByRole("button", { name: "More" }).click();
    await tilesPage.first().getByRole("menuitem", { name: "Info" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    const text = await dlg.innerText();
    ok(text.includes("a keeper at a lamp") && text.includes("Refine (painted)") && text.includes("96"), "Info shows the prompt, “Refine (painted)” and the size");
    await page.keyboard.press("Escape");
    ok((await stored(id)) === null, "the session is gone");
  }

  // ================= a saved header: the slot is left alone =================
  {
    const ctx = await fresh("Accept a header", { original: false });
    const headerBytes = async () => Buffer.from(await (await fetch(`${BASE}/api/chapters/${ctx.chapterId}/images/header`)).arrayBuffer()).toString("base64");
    await fetch(`${BASE}/api/chapters/${ctx.chapterId}/images/header`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: makePng(0) });
    const headerBefore = await headerBytes();
    await page.goto(`${BASE}/c/${ctx.chapterId}/illustrate`);
    const header = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Header picture" }) });
    await header.locator("img.image-editor-preview").waitFor();
    await header.getByRole("button", { name: "More" }).click();
    await header.getByRole("menuitem", { name: "Refine…" }).click();
    await page.waitForURL(/\/refine\/[a-z0-9]+$/);
    await ready();
    const id = /\/refine\/([a-z0-9]+)/.exec(page.url())[1];
    ok((await stored(id)).original.kind === "saved", "Refine… on the header starts a session on the saved picture");
    await paintGreen();
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    const jobs = await jobsOf(ctx.chapterId);
    ok(jobs.length === 1 && jobs[0].images[0].type === "input" && jobs[0].marks[0] === "pinned" && jobs[0].temporary === false && jobs[0].moment === "start", "the painted picture is a new pinned picture (moment start, the chapter's saved one)");
    ok(jobs[0].source === `saved:${ctx.chapterId}:header`, `…made from the saved header (${jobs[0].source})`);
    ok((await headerBytes()) === headerBefore, "the saved header is untouched");
    await until(async () => (await tilesPage.count()) === 1, "the pinned picture");
    ok((await tilesPage.locator("img").first().getAttribute("src")).includes(jobs[0].images[0].filename), "the picture is in the Pictures panel, where its ☰ menu can use it as the header");
    ok((await stored(id)) === null, "the session is gone");
  }

  // ================= the cover =================
  {
    const ctx = await fresh("Accept a cover", { original: false });
    const file = `StoryTime_9${++counter}_5.png`;
    await call("POST", "/api/picture-jobs", { story_id: ctx.storyId, prompt_id: `cover-${counter}-${Date.now()}`, prompt: "a lighthouse", negative: "", checkpoint: "x", width: 96, height: 60, seed: 1, count: 1, moment: "cover", images: [{ filename: file, subfolder: "", type: "output" }], unseen: false });
    await openSession(ctx, comfyOriginal(file), { kind: "cover", storyId: ctx.storyId });
    await paintGreen();
    await btn("Keep picture").click();
    await page.waitForURL(new RegExp(`/s/${ctx.storyId}/cover$`));
    const jobs = (await call("GET", `/api/picture-jobs?cover=${ctx.storyId}&temporary=1&limit=50`)).jobs;
    const made = jobs.find((j) => j.images[0].type === "input");
    ok(jobs.length === 2 && made && made.moment === "cover" && made.chapter_id === null && made.marks[0] === "pinned" && jobs.find((j) => j !== made).marks[0] === "rejected", "a cover picture is recorded as a pinned cover job and the old one is trashed");
  }

  // ================= errors, and trying again =================
  {
    const ctx = await fresh("Accept errors");
    const id = await openSession(ctx, comfyOriginal(ctx.file));
    await paintGreen();
    comfy.setMode({ fail: "upload" });
    const up = uploads();
    await btn("Keep picture").click();
    await page.getByRole("alert").filter({ hasText: /ComfyUI wouldn't take/ }).waitFor();
    ok(page.url().includes(`/refine/${id}`) && (await stored(id)) !== null && (await jobsOf(ctx.chapterId)).length === 1, "a refused upload shows an error, stays on the screen and keeps the session; nothing is recorded");
    ok(await btn("Keep picture").isEnabled() && (await btn("Keep picture").innerText()) === "Keep picture", "…Accept is back on");
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "(no sideways scrolling with the error)");
    comfy.setMode({ fail: null });
    const up2 = uploads(); // (the refused try counted too)

    // The record is made, then pinning fails; the retry must not upload or record again.
    let slow = 0;
    let breakMark = true;
    await page.route("**/api/picture-jobs/*/mark", async (route) => {
      if (breakMark) { await new Promise((r) => setTimeout(r, 500)); breakMark = false; slow++; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fake failure" }) }); }
      return route.continue();
    });
    await btn("Keep picture").click();
    await until(async () => (await btn("Saving…").count()) === 1, "the Saving… state");
    ok(await btn("Saving…").isDisabled() && await btn("Cancel").isDisabled() && await btn("Undo").isDisabled() && await btn("Go").isDisabled() && await btn("Show paint").isDisabled(), "while saving the button says Saving… and editing is off");
    const strokesBefore = await stage.getAttribute("data-strokes");
    await drag(0.2, 0.2, 0.8, 0.2);
    ok((await stage.getAttribute("data-strokes")) === strokesBefore, "…and dragging on the picture draws nothing");
    await page.getByRole("alert").filter({ hasText: "Fake failure" }).waitFor();
    ok(slow === 1 && page.url().includes(`/refine/${id}`), "a refused pin shows an error and stays");
    const afterFail = await jobsOf(ctx.chapterId);
    const upAfterFail = uploads();
    ok(afterFail.length === 2 && upAfterFail === up2 + 1, "…the painted picture was uploaded (not again) and recorded once so far");
    const rec = (await stored(id)).accepting;
    ok(rec && rec.jobId && rec.image && rec.image.type === "input", "…the session remembers the upload and the record");
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    const jobs = await jobsOf(ctx.chapterId);
    const made = jobs.filter((j) => j.images[0].type === "input");
    ok(jobs.length === 2 && made.length === 1 && made[0].marks[0] === "pinned" && uploads() === upAfterFail, "trying again records and uploads nothing twice: one new picture, pinned");
    ok(jobs.find((j) => j !== made[0]).marks[0] === "rejected" && (await stored(id)) === null, "…the original is trashed and the session is gone");
    await page.unroute("**/api/picture-jobs/*/mark");
  }

  // ================= a phone =================
  {
    const ctx = await fresh("Accept phone");
    await openSession(ctx, comfyOriginal(ctx.file));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 390 px the screen with Accept does not scroll sideways");
    const h = await btn("Keep picture").boundingBox();
    ok(h && h.height >= 40 && h.width >= 60, `…and Accept is big enough to tap (${Math.round(h.width)} x ${Math.round(h.height)})`);
    await btn("Keep picture").click();
    await waitIllustrate(ctx);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await context.close();
} finally {
  for (const id of stories) await fetch(`${BASE}/api/stories/${id}`, { method: "DELETE" }).catch(() => {});
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
