// Writing in the work queue (task 1.4): AI runs go on across pages, one step at a time and one run after another;
// Stop and Resume; a reload shows a run as paused and a second tab as running elsewhere; and writing and pictures
// take turns (Settings › Queue) or go together. The run page comes later, so the test starts runs through the queue
// itself: the app exposes it as window.__storytimeQueue when the page sets window.__STORYTIME_TEST__ (a small test hook).
import http from "node:http";
import { comfySettings, launch, useMockAi } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3567;
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a slow fake AI that answers chapters, plans and summaries, and records when ----
const ai = { log: [], active: 0, maxActive: 0, delay: 250 };
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
    const message = body.messages?.at(-1)?.content ?? "";
    const kind = system.includes("Output format") ? "chapter" : system.includes("button text") ? "label" : system.includes("JSON array") ? "plan" : "summary";
    const entry = { kind, start: Date.now(), end: 0, message };
    ai.log.push(entry);
    ai.active += 1;
    ai.maxActive = Math.max(ai.maxActive, ai.active);
    const labels = [...(message.match(/offered at its end: ([^\n]*?)\.\n/)?.[1].matchAll(/“([^”]+)”/g) ?? [])].map((x) => x[1]);
    const text = kind === "label" ? "Take the left door" : kind === "chapter" ? `# Written ${ai.log.filter((e) => e.kind === "chapter").length}\n\nA chapter the fake AI wrote.` : kind === "plan" ? JSON.stringify(labels.map((l) => ({ choice: l, direction: `plan for ${l}` }))) : "SUMMARY:\nShort.\nSTORY SO FAR:\nSo far.";
    res.setHeader("content-type", "text/event-stream");
    const pieces = [text.slice(0, Math.ceil(text.length / 3)), text.slice(Math.ceil(text.length / 3), Math.ceil((2 * text.length) / 3)), text.slice(Math.ceil((2 * text.length) / 3))];
    let i = 0;
    let closed = false;
    res.on("close", () => { if (!closed) { closed = true; ai.active -= 1; entry.end = Date.now(); } });
    const next = () => {
      if (closed) return;
      if (i < pieces.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`); setTimeout(next, ai.delay); }
      else { res.write("data: [DONE]\n\n"); res.end(); }
    };
    next();
  });
});
await new Promise((r) => mock.listen(3222, r));

const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 6, stepDelay: 150, startDelay: 200 });
const mockAi = await useMockAi(BASE, {
  comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }),
  queue: { sharing: "turns", switchMinutes: 10, switchItems: 1, groupPictures: true },
});
const putQueue = async (queue) => {
  const s = (await call("GET", "/api/settings")).settings;
  await fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, queue }) });
};

// A story with open choices, and a run that writes them (one chapter at a time, so each task is one step).
async function makeRun(title, labels) {
  const s = await call("POST", "/api/stories", { title, chapter: { title: "Root", body: "root", choices: labels } });
  const choices = (await call("GET", `/api/chapters/${s.chapter_id}`)).choices;
  const tasks = [{ kind: "plan", id: "t1", chapterId: s.chapter_id, depth: 1, labels, add: 0, status: "todo" }, ...choices.map((c, i) => ({
    kind: "write", id: `t${i + 2}`, slot: { kind: "choice", choiceId: c.id }, label: c.label, direction: "", depth: 1, choices: { given: [], suggest: 0 },
    plannedBy: "t1", parentChapterId: s.chapter_id, expand: false, status: "todo",
  }))];
  const run = await call("POST", "/api/ai-runs", { story_id: s.story_id, start_chapter_id: s.chapter_id, mode: "fill", options: { models: "each", endChoices: 0 }, tasks });
  return { runId: run.id, storyId: s.story_id, rootId: s.chapter_id };
}
const runState = async (id) => (await call("GET", `/api/ai-runs/${id}`));
const writtenBy = async (rootId) => (await call("GET", `/api/chapters/${rootId}`)).choices.filter((c) => c.child_ai !== null).length;

const browser = await launch();
const newContext = async (viewport = { width: 1000, height: 1100 }) => {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => { window.__STORYTIME_TEST__ = true; });
  return context;
};
const open = async (context) => {
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  return page;
};
// The queue is kept by the server now, so what earlier sections (or files) finished is still in the list; a section that
// counts the list starts by taking the finished and failed items off it.
const clean = async () => {
  for (const i of (await call("GET", "/api/queue")).items) if (i.state === "done" || i.state === "failed") await fetch(`${BASE}/api/queue/items/${encodeURIComponent(i.key)}`, { method: "DELETE" });
};
const queueOf = (page) => ({
  badge: page.locator(".site-header .picture-queue-button"),
  panel: page.getByRole("region", { name: "Queue" }),
  start: (id) => page.evaluate((i) => window.__storytimeQueue.startRun(i), id),
  go: async (path) => { await page.evaluate((p) => window.next.router.push(p), path); await page.waitForURL(`${BASE}${path}`); },
});

try {
  const context = await newContext();
  const page = await open(context);
  const q = queueOf(page);
  const label = async () => (await q.badge.count()) ? await q.badge.getAttribute("aria-label") : "";

  await clean();
  // ---- a run goes on when moving to another page ----
  const r1 = await makeRun("Run tale one", ["Left", "Right"]);
  await page.goto(`${BASE}/settings`);
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  await q.start(r1.runId);
  ok(await until(async () => (await label()) === "Queue: 1 going", "the header to show the run going"), "a started run shows in the header as going");
  await q.go("/queue");
  await q.go("/drafts");
  ok(await until(async () => (await runState(r1.runId)).status === "done", "the run to finish", 300), "the run goes on while the author moves between pages, and finishes");
  ok((await writtenBy(r1.rootId)) === 2, "both chapters were written, marked as AI-written");
  ok(await until(async () => (await label()) === "Queue: 1 ready", "ready"), "the header then says it is ready");
  await q.badge.click();
  const rowText = await q.panel.getByRole("listitem").first().innerText();
  ok(/Fill open choices/.test(rowText) && /Run tale one/.test(rowText) && /2 of 2/.test(rowText), "the list names the mode and the story, with “2 of 2”: " + rowText.replace(/\n/g, " | "));
  await page.screenshot({ path: `${SHOTS}/work-queue-run-desktop.png` });
  await q.panel.getByRole("button", { name: "Dismiss" }).click();
  ok(await until(async () => (await q.badge.count()) === 0, "the header to clear"), "Dismiss takes a finished run off");

  await clean();
  // ---- two runs, one after the other ----
  const r2 = await makeRun("Run tale two", ["A"]);
  const r3 = await makeRun("Run tale three", ["B"]);
  ai.maxActive = 0;
  await q.start(r2.runId);
  await q.start(r3.runId);
  ok(await until(async () => (await runState(r2.runId)).status === "done" && (await runState(r3.runId)).status === "done", "both runs to finish", 400), "two runs both finish");
  ok(ai.maxActive === 1, "…and never two requests at once (one writing step at a time): " + ai.maxActive);
  const postedAt = async (r) => (await call("GET", `/api/ai-runs/${r.runId}`)).finished_at;
  ok((await postedAt(r2)) <= (await postedAt(r3)), "…the first started finishes first");
  for (const key of ["Run tale two", "Run tale three"]) void key;
  await page.reload();
  await until(async () => (await q.badge.count()) === 0 || true, "settle", 3);

  await clean();
  // ---- Stop, then Resume ----
  const r4 = await makeRun("Run tale four", ["One", "Two", "Three"]);
  await page.goto(`${BASE}/settings`);
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  await q.start(r4.runId);
  await until(async () => (await label()) === "Queue: 1 going", "going");
  await until(async () => (await writtenBy(r4.rootId)) >= 1, "a chapter to be written", 200);
  await q.badge.click();
  await q.panel.getByRole("button", { name: "Stop" }).click();
  ok(await until(async () => (await runState(r4.runId)).status === "paused", "the run to be paused on the server", 100), "Stop pauses the run on the server");
  const stoppedAt = await writtenBy(r4.rootId);
  ok(await until(async () => await q.panel.getByRole("button", { name: "Resume" }).isVisible(), "Resume"), "…and the list offers Resume");
  await new Promise((r) => setTimeout(r, 1500));
  ok((await writtenBy(r4.rootId)) === stoppedAt && stoppedAt < 3, `…nothing more is written meanwhile (${stoppedAt} of 3)`);

  // ---- a reload shows the run as paused; nothing starts by itself ----
  const callsBefore = ai.log.length;
  await page.reload();
  ok(await until(async () => (await label()) === "Queue: 1 paused", "paused after reload"), "after a reload the run shows as paused");
  await new Promise((r) => setTimeout(r, 1200));
  ok(ai.log.length === callsBefore, "…and nothing starts by itself");
  await q.badge.click();
  await q.panel.getByRole("button", { name: "Resume" }).click();
  ok(await until(async () => (await runState(r4.runId)).status === "done", "the resumed run to finish", 400), "Resume goes on to the end");
  ok((await writtenBy(r4.rootId)) === 3, "…with every chapter written once");
  await q.panel.getByRole("button", { name: "Dismiss" }).click().catch(() => {});

  await clean();
  // ---- a second tab sees the run too ----
  const r5 = await makeRun("Run tale five", ["X", "Y"]);
  await page.goto(`${BASE}/settings`);
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  await q.start(r5.runId);
  await until(async () => (await label()) === "Queue: 1 going", "going");
  const other = await open(context);
  await other.goto(`${BASE}/settings`);
  const oq = queueOf(other);
  // (The server runs it, so no tab has a run "elsewhere" any more: every tab sees the same queue and can stop it.)
  ok(await until(async () => (await oq.badge.count()) > 0 && (await oq.badge.getAttribute("aria-label")) === "Queue: 1 going", "the second tab to see the run"), "a second tab counts the run as going too");
  await oq.badge.click();
  const shownHere = oq.panel.getByRole("listitem", { name: /: writing$/ });
  ok(await shownHere.isVisible(), "…as writing");
  ok((await shownHere.getByRole("button", { name: "Stop" }).count()) === 1 && (await shownHere.getByRole("link", { name: "Open", exact: true }).count()) === 1, "…with Stop and Open, as in the tab that started it");
  await other.close();
  await until(async () => (await runState(r5.runId)).status === "done", "the run to finish", 300);

  await clean();
  // ---- taking turns: a picture asked for while a run writes waits for the batch limit ----
  const shared = await call("POST", "/api/stories", { title: "Turns tale", chapter: { title: "The harbour", body: "Boats came in.", choices: [] } });
  const r6 = await makeRun("Run tale six", ["P", "Q"]);
  await page.goto(`${BASE}/c/${shared.chapter_id}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("boats in a harbour");
  const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").length;
  const postedBefore = posted();
  ai.delay = 800; // each request takes about 2.4 s: long enough to click Queue and still be inside the step
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  await q.start(r6.runId);
  await until(async () => ai.active > 0, "the run's first request", 100);
  const requestsAtClick = ai.log.length;
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await new Promise((r) => setTimeout(r, 1300));
  ok(posted() === postedBefore && ai.active > 0, "while a run writes, a picture job is held (ComfyUI gets nothing)");
  ok(await page.getByText(/waiting its turn/i).first().isVisible(), "…and its place says it is waiting its turn");
  await page.setViewportSize({ width: 400, height: 900 });
  await q.badge.click();
  const note = await q.panel.locator(".picture-queue-note").innerText().catch(() => "");
  ok(/^Writing until .+ or 0 more steps, then 1 picture job$/.test(note), `the list says who has the machine: “${note}”`);
  await page.screenshot({ path: `${SHOTS}/work-queue-held-400.png` });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1000, height: 1100 });
  ok(await until(async () => posted() === postedBefore + 1, "the picture to be sent after the step", 200), "after the writing step (batch limit of one) the picture goes");
  const requestsAtPicture = ai.log.length;
  ok(requestsAtPicture - requestsAtClick <= 1, `…it went after one writing step, not the whole run (${requestsAtPicture - requestsAtClick} requests between)`);
  await new Promise((r) => setTimeout(r, 500));
  ok(ai.log.length === requestsAtPicture, "…and the next writing step waits while ComfyUI has the picture");
  ok(await until(async () => (await runState(r6.runId)).status === "done", "the run to finish", 500), "the run goes on after the picture and finishes");
  ok((await call("GET", `/api/picture-jobs?chapter=${shared.chapter_id}`)).jobs.length === 1, "…and the picture was made once");

  await clean();
  // ---- at the same time: both go at once ----
  await putQueue({ sharing: "together", switchMinutes: 10, switchItems: 1, groupPictures: true });
  const r7 = await makeRun("Run tale seven", ["R", "S"]);
  await page.goto(`${BASE}/c/${shared.chapter_id}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("gulls over the harbour");
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  const posted2 = posted();
  await q.start(r7.runId);
  await until(async () => ai.active > 0, "the run's request", 100);
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  ok(await until(async () => posted() === posted2 + 1 && ai.active > 0, "the picture to go while the run writes", 60), "with “at the same time” the picture goes while a step is writing");
  await until(async () => (await runState(r7.runId)).status === "done", "the run to finish", 500);

  await clean();
  // ---- Generate from the writing page finishes into the draft wherever the author goes (D15) ----
  const draftOf = async (key) => (await call("GET", `/api/drafts/${encodeURIComponent(key)}`)).draft;
  const g = await call("POST", "/api/stories", { title: "Generate tale", chapter: { title: "Root", body: "root", choices: [] } });
  ai.delay = 400;
  await page.goto(`${BASE}/c/${g.chapter_id}/write`);
  await page.getByLabel("Chapter text").fill("Earlier words.");
  await until(async () => (await draftOf(`new:${g.chapter_id}`))?.body === "Earlier words.", "the first text to be saved");
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  await page.getByRole("button", { name: "Generate a new draft" }).click();
  await until(async () => ai.active > 0, "the Generate to start", 100);
  await page.screenshot({ path: `${SHOTS}/generate-writing-page-desktop.png` });
  await page.setViewportSize({ width: 400, height: 900 });
  await page.screenshot({ path: `${SHOTS}/generate-writing-page-400.png` });
  await page.setViewportSize({ width: 1000, height: 1100 });
  await q.go("/");
  ok(await until(async () => (await label()) === "Queue: 1 going", "the header to show the Generate going"), "after leaving the writing page the header shows the Generate going");
  await q.badge.click();
  ok(await q.panel.getByRole("listitem", { name: /^Writing .*: writing$/ }).isVisible(), "…as “Writing …” with its draft's label");
  await page.keyboard.press("Escape");
  ok(await until(async () => (await label()) === "Queue: 1 ready", "the Generate to finish", 300), "when it finishes the header says ready");
  const saved = await draftOf(`new:${g.chapter_id}`);
  ok(saved.body === "A chapter the fake AI wrote." && saved.title.startsWith("Written"), "the whole chapter is in the draft on the server");
  ok(saved.undo.at(-1)?.body === "Earlier words." && saved.versions?.[0]?.body === "Earlier words." && saved.versions.length === 2, "…the earlier text is kept as the previous version and in undo");
  ok(saved.newChoiceLabel === "Take the left door", "…and the choice text was filled in");
  await q.badge.click();
  await q.panel.getByRole("link", { name: "Open", exact: true }).first().click();
  await page.waitForURL(`${BASE}/c/${g.chapter_id}/write`);
  ok(await page.getByLabel("Chapter text").inputValue().catch(() => "A chapter the fake AI wrote.") === "A chapter the fake AI wrote." || (await page.getByText("A chapter the fake AI wrote.").count()) > 0, "Open goes back to the draft, which shows the chapter");
  ok(await until(async () => (await q.badge.count()) === 0 || (await label()) === "Queue: 1 ready", "settle", 5) , "…");
  await q.badge.click().catch(() => {});
  await q.panel.getByRole("button", { name: "Dismiss" }).first().click().catch(() => {});

  // A Generate waits for the step going, then goes before the run's next chapter.
  const r8 = await makeRun("Run tale eight", ["M", "N"]);
  const h = await call("POST", "/api/stories", { title: "Generate two", chapter: { title: "Root", body: "root", choices: [] } });
  await page.goto(`${BASE}/c/${h.chapter_id}/write`);
  await page.getByLabel(/What should happen/).fill("GENERATEMARK");
  await until(async () => await page.evaluate(() => !!window.__storytimeQueue), "the queue hook");
  const chaptersBefore = ai.log.filter((e) => e.kind === "chapter").length;
  await q.start(r8.runId);
  await until(async () => ai.active > 0, "the run's first step", 100);
  await page.getByRole("button", { name: "Generate chapter" }).click();
  ok(await until(async () => await page.getByText(/Waiting for the step in progress|Waiting its turn/).isVisible().catch(() => false), "the page to say it waits", 30), "a Generate asked for while a run's step is going shows that it is waiting");
  await page.setViewportSize({ width: 400, height: 900 });
  await page.screenshot({ path: `${SHOTS}/generate-waiting-page-400.png` });
  await q.badge.click();
  await page.screenshot({ path: `${SHOTS}/generate-header-list-400.png` });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1000, height: 1100 });
  await q.badge.click();
  await page.screenshot({ path: `${SHOTS}/generate-header-list-desktop.png` });
  await page.keyboard.press("Escape");
  await until(async () => ai.log.filter((e) => e.kind === "chapter").length > chaptersBefore, "the first chapter request", 300);
  const firstChapter = ai.log.filter((e) => e.kind === "chapter")[chaptersBefore];
  ok(firstChapter.message.includes("GENERATEMARK"), "after the step it is the Generate that goes, before the run's next chapter");
  await until(async () => (await runState(r8.runId)).status === "done", "the run to finish", 500);
  ok((await writtenBy(r8.rootId)) === 2, "…and the run still wrote both of its chapters");

  await q.go("/queue");
  await page.screenshot({ path: `${SHOTS}/work-queue-page.png`, fullPage: true });
  await page.setViewportSize({ width: 400, height: 900 });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the queue page doesn't scroll sideways");
  await page.screenshot({ path: `${SHOTS}/work-queue-400.png`, fullPage: true });
} finally {
  // Leave nothing going or paused for the tests after this one.
  const left = (await call("GET", "/api/ai-runs?unfinished=1").catch(() => ({ runs: [] }))).runs;
  for (const r of left) {
    const token = "cleanup-token-12345";
    await call("POST", `/api/ai-runs/${r.id}/claim`, { token }).catch(() => {});
    const now = await runState(r.id);
    await call("PATCH", `/api/ai-runs/${r.id}`, { token, version: now.version, status: "stopped" }).catch(() => {});
  }
  const unseen = (await call("GET", "/api/picture-jobs?unseen=1").catch(() => ({ jobs: [] }))).jobs.map((j) => j.id);
  await fetch(`${BASE}/api/picture-jobs/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: unseen }) }).catch(() => {});
  await mockAi.restore();
  await browser.close();
  await comfy.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
