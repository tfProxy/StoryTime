// Make missing pictures (/s/<id>/pictures): the header (and footer) pictures chapters lack, written as prompts by the
// fake AI and drawn by the fake ComfyUI through the picture queue, saved as the chapters' pictures.
import http from "node:http";
import { comfySettings, launch, useMockAi } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3568;
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const hasPicture = async (chapterId, slot) => (await fetch(`${BASE}/api/chapters/${chapterId}/images/${slot}`, { method: "HEAD" })).status === 200;

// ---- a fake model that writes a picture prompt, one at a time ----
const ai = { prompts: [], postedAt: [], delay: 30 };
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    if (!body.messages) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [] })); }
    ai.prompts.push(body.messages.at(-1).content);
    ai.postedAt.push(posted().length);
    const reply = JSON.stringify({ scene: `Scene ${ai.prompts.length}`, prompt: `harbour picture ${ai.prompts.length}`, negative: "text, watermark" });
    res.setHeader("content-type", "text/event-stream");
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    }, ai.delay);
  });
});
await new Promise((r) => mock.listen(3222, r));

const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 3, stepDelay: 100, startDelay: 100 });
const mockAi = await useMockAi(BASE, {
  comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }),
  queue: { sharing: "together", switchMinutes: 10, switchItems: 0, groupPictures: true },
});
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");

/** A story of three chapters in a row; the first has a header already. */
async function makeStory(title, withHeader = true) {
  const s = await call("POST", "/api/stories", { title, premise: "A harbour town.", chapter: { title: "Docks", body: "Boats came in.", choices: ["Walk on"] } });
  const ids = [s.chapter_id];
  for (const t of ["Market", "Lighthouse"]) {
    const choice = (await call("GET", `/api/chapters/${ids.at(-1)}`)).choices[0];
    ids.push((await call("POST", "/api/chapters", { choice_id: choice.id, title: t, body: `${t} text.`, choices: t === "Market" ? ["Climb"] : [] })).chapter_id);
  }
  if (withHeader) await fetch(`${BASE}/api/chapters/${ids[0]}/images/header`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  return { storyId: s.story_id, ids };
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
await context.addInitScript(() => { window.__STORYTIME_TEST__ = true; });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const form = () => page.locator("form.write-ahead-form");
const runsOf = async (storyId) => (await call("GET", `/api/stories/${storyId}/ai-runs?mode=pictures`)).runs;
const waitRun = async (storyId, status, tries = 400) => until(async () => (await runsOf(storyId))[0]?.status === status, `the picture run to be ${status}`, tries);

try {
  // ---- the menus ----
  const a = await makeStory("Picture tale");
  await page.goto(`${BASE}/c/${a.ids[1]}`);
  await page.getByLabel("Menu", { exact: true }).click();
  ok(await page.locator(".site-menu-items").getByRole("link", { name: "Make missing pictures…" }).isVisible(), "the chapter's ☰ menu has Make missing pictures…");
  await page.goto(`${BASE}/s/${a.storyId}/outline`);
  await page.getByLabel("Menu", { exact: true }).click();
  ok(await page.locator(".site-menu-items").getByRole("link", { name: "Make missing pictures" }).isVisible(), "the story's menu (the outline) has Make missing pictures");

  // ---- the form: the whole story, headers ----
  await page.goto(`${BASE}/s/${a.storyId}/pictures`);
  await page.getByRole("heading", { name: "Make missing pictures" }).waitFor();
  ok(await page.getByText("The whole story (3 chapters)").isVisible(), "the form lists the whole story");
  ok(await form().getByLabel("Header pictures").isChecked(), "Header is the default");
  ok(!(await form().getByLabel(/Use reference pictures/).isChecked()), "reference pictures are off by default");
  ok(await page.getByText("Makes 2 pictures, one at a time, with 2 prompt requests.").isVisible(), "the estimate counts the chapters without a header (2 of 3)");
  await form().getByLabel("Both").check();
  ok(await page.getByText("Makes 5 pictures, one at a time, with 5 prompt requests.").isVisible(), "…and with both slots, the footers too (5)");
  await form().getByLabel("Footer pictures").check();
  ok(await page.getByText(/Makes 3 pictures/).isVisible(), "…footers alone are 3");
  await form().getByLabel("Header pictures").check();
  await page.screenshot({ path: `${SHOTS}/missing-pictures-form-desktop.png`, fullPage: true });

  // ---- run it ----
  const sentBefore = posted().length;
  await form().getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/pictures\?picrun=/);
  ok(await waitRun(a.storyId, "done", 600), "the run finishes");
  ok((await hasPicture(a.ids[1], "header")) && (await hasPicture(a.ids[2], "header")) && (await hasPicture(a.ids[0], "header")), "every chapter has its header picture");
  ok(posted().length - sentBefore === 2, "ComfyUI was asked for two pictures, not three (the chapter that had one was left alone)");
  ok(ai.prompts.length === 2 && ai.prompts[0].includes("Market") && ai.prompts[1].includes("Lighthouse"), "a prompt was written for each, from the story down to that chapter, in outline order");
  ok(ai.postedAt.length === 2 && ai.postedAt.every((n) => n === sentBefore), "every prompt was written before any picture was sent to ComfyUI");
  ok(await page.getByText(/Made 2 pictures/).isVisible(), "the page says it made 2 pictures");
  ok((await page.locator(".ai-run-tasks img").count()) === 2, "…with a thumbnail per picture");
  const draft = (await call("GET", `/api/chapters/${a.ids[1]}/picture-draft`)).draft;
  ok(draft?.start?.prompt?.includes("harbour picture") && draft.start.scene.startsWith("Scene"), "the prompt used is kept as that chapter's prompt boxes, so the Illustrate page shows it");
  const jobs = (await call("GET", `/api/picture-jobs?chapter=${a.ids[1]}`)).jobs;
  ok(jobs.length === 1 && !jobs[0].temporary && jobs[0].images.length === 1, "the picture job is in the job log, not as a temporary one");
  ok(!posted().slice(sentBefore).some((c) => JSON.stringify(c.body).includes("IPAdapter")), "with reference pictures off no IP-Adapter nodes are sent");
  await page.screenshot({ path: `${SHOTS}/missing-pictures-done-desktop.png`, fullPage: true });
  const unseen = (await call("GET", "/api/picture-jobs?unseen=1")).jobs;
  ok(!unseen.some((j) => a.ids.includes(j.chapter_id)), `the saved pictures are not left as new (${unseen.length} unseen jobs)`);

  // ---- footers, with nothing else to make ----
  await page.goto(`${BASE}/s/${a.storyId}/pictures`);
  ok(await page.getByText(/already has its header picture/).isVisible() && await form().getByRole("button", { name: "Start" }).isDisabled(), "with every header made there is nothing to make");
  await form().getByLabel("Footer pictures").check();
  await form().getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/pictures\?picrun=/);
  ok(await until(async () => (await runsOf(a.storyId)).filter((r) => r.status === "done").length === 2, "the footer run", 600), "a run for footers makes them");
  ok((await Promise.all(a.ids.map((id) => hasPicture(id, "footer")))).every(Boolean), "every chapter has its footer picture too");

  // ---- Stop, then Resume ----
  comfy.setMode({ stepDelay: 400 });
  const b = await makeStory("Resume tale", false);
  await page.goto(`${BASE}/s/${b.storyId}/pictures`);
  await form().getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/pictures\?picrun=/);
  await until(async () => (await runsOf(b.storyId))[0]?.counts.written + (await runsOf(b.storyId))[0]?.counts.done >= 1, "a prompt written", 300);
  // Away from the run's page, the queue's list leads back to it.
  await page.evaluate(() => window.next.router.push("/settings"));
  await page.waitForURL(`${BASE}/settings`);
  await page.locator(".site-header .picture-queue-button").click();
  await page.getByRole("region", { name: "Queue" }).getByRole("link", { name: "Open" }).first().click();
  await page.waitForURL(/\/s\/[^/]+\/pictures\?picrun=/);
  ok(true, "the queue's list links back to the picture run's page");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  ok(await waitRun(b.storyId, "paused", 100), "Stop pauses the run");
  const madeBefore = (await Promise.all(b.ids.map((id) => hasPicture(id, "header")))).filter(Boolean).length;
  await page.goto(`${BASE}/s/${b.storyId}/pictures`);
  ok(await page.getByText(/A picture run for this story is unfinished/).isVisible(), "the page offers the unfinished run first");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForURL(/pictures\?picrun=/);
  ok(await waitRun(b.storyId, "done", 800), "Resume finishes the run");
  ok((await Promise.all(b.ids.map((id) => hasPicture(id, "header")))).every(Boolean) && madeBefore < 3, "every chapter ends with its header picture (some were made after Resume)");

  // ---- the chapters a write-ahead run wrote ----
  const c = await makeStory("Run tale", false);
  const run = await call("POST", "/api/ai-runs", { story_id: c.storyId, start_chapter_id: c.ids[0], mode: "fill", options: {}, tasks: [] });
  const open = await call("POST", `/api/chapters/${c.ids[2]}/choices`, { label: "On" });
  void open;
  const extra = (await call("POST", "/api/chapters", { parent_chapter_id: c.ids[2], new_choice_label: "Wrote this", title: "Written by run", body: "x", ai_run_id: run.id })).chapter_id;
  await page.goto(`${BASE}/s/${c.storyId}/pictures?run=${run.id}`);
  ok(await page.getByText("The chapters the write-ahead run wrote (1 chapters)").isVisible() && await form().getByLabel(/The chapters the write-ahead run wrote/).isChecked(), "a write-ahead run's chapters are offered, and chosen");
  ok(await page.getByText("Makes 1 picture, one at a time, with 1 prompt request.").isVisible(), "…making pictures for just those");
  void extra;

  // ---- phone width ----
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto(`${BASE}/s/${a.storyId}/pictures`);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the page doesn't scroll sideways");
  await page.screenshot({ path: `${SHOTS}/missing-pictures-form-400.png`, fullPage: true });
} finally {
  const left = (await call("GET", "/api/ai-runs?unfinished=1").catch(() => ({ runs: [] }))).runs;
  for (const r of left) {
    const token = "cleanup-token-12345";
    const got = await call("POST", `/api/ai-runs/${r.id}/claim`, { token }).catch(() => null);
    if (got?.version) await call("PATCH", `/api/ai-runs/${r.id}`, { token, version: got.version, status: "stopped" }).catch(() => {});
  }
  const unseen = (await call("GET", "/api/picture-jobs?unseen=1").catch(() => ({ jobs: [] }))).jobs.map((j) => j.id);
  await fetch(`${BASE}/api/picture-jobs/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: unseen }) }).catch(() => {});
  await mockAi.restore();
  await browser.close();
  await comfy.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
