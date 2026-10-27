// Jobs found in ComfyUI (the scan) and picture jobs left over from before a restart (recovery): both pick up jobs that
// nothing in this server is watching, wait for them if they are still being made, and record them once.
import Database from "better-sqlite3";
import { startFakeComfy } from "../e2e/fakeComfy.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(40);
  }
};

const comfy = await startFakeComfy({ port: 3562, steps: 2, stepDelay: 40 });
const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const made = [];
try {
  await call("PUT", "/api/settings", { ...(settingsBefore ?? {}), comfy: { ...(settingsBefore?.comfy ?? {}), url: comfy.url } });
  const story = (await call("POST", "/api/stories", { title: "Scan tale", chapter: { title: "Root", body: "b", choices: [] } })).json;
  const { story_id: storyId, chapter_id: chapterId } = story;
  const me = (await call("GET", "/api/instance")).json.id;
  const target = { kind: "chapter", storyId, chapterId };

  const tag = (prompt, over = {}) => ({
    storytime: {
      chapterId, storyId, clientId: `storytime-${prompt.replace(/\W/g, "")}`,
      job: { prompt, negative: "", checkpoint: "fake_sdxl_a.safetensors", width: 96, height: 60, seed: 1, count: 1, moment: "start" },
      instance: me,
      ...over,
    },
  });
  const items = async () => (await call("GET", "/api/queue")).json.items.filter((i) => i.type === "picture");
  const byPrompt = async (id) => (await items()).find((i) => i.data.promptId === id);
  const logged = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).json.jobs;
  const scan = () => call("POST", "/api/queue/test-scan?do=scan");

  // ---- the scan ----
  const mine = comfy.addJob({ extra: tag("mine, done") });
  const other = comfy.addJob({ extra: tag("another instance", { instance: "someone-elses-id" }) });
  const nowhere = comfy.addJob({ extra: tag("no such chapter", { chapterId: "nope-chapter", storyId: "nope-story" }) });
  const legacy = comfy.addJob({ extra: tag("before jobs had an id", { instance: undefined }) });
  ok((await scan()).status === 200, "the scan runs");
  const found = await byPrompt(mine);
  ok(found?.state === "done" && found.data.pictures.length === 1 && found.data.pictures[0].prompt === "mine, done" && found.data.unseen === true, "a finished job of this StoryTime that was never recorded is recorded and kept, not seen yet");
  if (found) made.push(found.key);
  ok((await logged()).filter((j) => j.prompt_id === mine).length === 1, "…and is in the log once");
  const legacyItem = await byPrompt(legacy);
  if (legacyItem) made.push(legacyItem.key);
  ok(legacyItem?.state === "done", "a job from before jobs carried an id is picked up when its chapter is here");
  ok(!(await byPrompt(other)) && !(await byPrompt(nowhere)), "a job of another instance, or for a chapter that is not here, is ignored");
  const count = (await items()).length;
  await scan();
  ok((await items()).length === count && (await logged()).filter((j) => j.prompt_id === mine).length === 1, "scanning again picks nothing up twice");

  // A job still being made is shown again, and can be stopped (the fake never finishes it).
  const running = comfy.addJob({ extra: tag("still running"), state: "running" });
  await scan();
  const live = await byPrompt(running);
  if (live) made.push(live.key);
  ok(live?.state === "working" && live.data.view.prompt === "still running" && live.data.target.chapterId === chapterId, "a job ComfyUI is still making is shown as working");
  const callsBefore = comfy.calls.length;
  ok(live && (await call("POST", `/api/queue/items/${encodeURIComponent(live.key)}`, { action: "stop" })).status === 200, "…and can be stopped");
  ok(!!(await until(async () => !(await byPrompt(running)))), "…it leaves the queue");
  ok(comfy.calls.slice(callsBefore).some((c) => c.path === "/queue" || c.path === "/interrupt"), "…and is taken off ComfyUI");

  // ---- restart recovery ----
  const left = (key, data) => call("POST", "/api/queue/test-items", { key, type: "picture", state: "working", data: { target, spec: { comfy: { url: comfy.url } }, count: 1, view: {}, ...data } });
  const recover = () => call("POST", "/api/queue/test-scan?do=recover");

  const finishedMeanwhile = comfy.addJob({ extra: tag("finished while stopped") });
  made.push("job-left-1", "job-left-2", "job-left-3");
  await left("job-left-1", { promptId: finishedMeanwhile });
  await left("job-left-2", {});
  await left("job-left-3", { promptId: "gone-from-comfy" });
  await call("PUT", "/api/queue/paused", { paused: true }); // so the job that goes back to waiting is not sent
  ok((await recover()).status === 200, "recovery runs");
  ok(!!(await until(async () => (await items()).find((i) => i.key === "job-left-1")?.state === "done")), "(the job found in ComfyUI is waited for)");
  const one = (await items()).find((i) => i.key === "job-left-1");
  ok(one?.state === "done" && one.data.pictures.length === 1, "a job that was in ComfyUI when the server stopped is waited for and finishes");
  ok((await logged()).filter((j) => j.prompt_id === finishedMeanwhile).length === 1, "…and is recorded once");
  const two = (await items()).find((i) => i.key === "job-left-2");
  ok(two?.state === "waiting", "a job that had not been queued on ComfyUI goes back to waiting");
  const three = (await items()).find((i) => i.key === "job-left-3");
  ok(three?.state === "failed" && /no longer has this job/.test(three.data.message ?? ""), "a job ComfyUI does not know fails, and says so");
  await scan();
  ok((await logged()).filter((j) => j.prompt_id === finishedMeanwhile).length === 1, "a later scan does not record it again");
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  for (const key of made) await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(key)}`);
  await comfy.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
