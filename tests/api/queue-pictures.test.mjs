// Picture jobs on the server, asking and gathering: quick clicks with the same settings make one job, a changed click
// closes it and starts another, and a closed job waits to be sent. (Sending is tested with it.)
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const spec = (extra = {}, comfy = {}) => ({
  prompt: "a red fox",
  negative: "blurry",
  moment: "start",
  // Only what the gathering reads; the rest of a job is for sending it.
  comfy: { url: "http://localhost:3999", width: 1024, height: 1024, batchClicks: true, ...comfy },
  draw: { id: "draw1", checkpoint: "model.safetensors", sampler: "euler" },
  drawLoras: [],
  family: null,
  redraw: 0.55,
  start: null,
  refs: [],
  mask: null,
  edit: null,
  seed: null,
  ...extra,
});
const target = (chapterId) => ({ kind: "chapter", storyId: "s-pictures", chapterId });
const ask = (chapterId, s = spec()) => call("POST", "/api/queue/pictures", { target: target(chapterId), spec: s, view: { label: "Header", moment: "header" } });
const itemOf = async (key) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === key);
const made = [];
const remember = (r) => { made.push(r.json.item.key); return r.json.item; };

// Hold the queue, so closed jobs stay waiting.
await call("PUT", "/api/queue/paused", { paused: true });
try {
  // Two quick clicks with the same settings are one job of two.
  let a = remember(await ask("c1"));
  ok(a.type === "picture" && a.state === "gathering" && a.data.count === 1 && a.data.target.chapterId === "c1" && a.data.view.label === "Header", "a click makes a gathering picture job");
  const again = await ask("c1");
  ok(again.status === 201 && again.json.item.key === a.key && again.json.item.data.count === 2, "a second click with the same settings joins it");
  await sleep(1200);
  a = await itemOf(a.key);
  ok(a.state === "waiting" && a.readyAt > 0 && a.data.count === 2, "…and 800 ms after the last click it is closed and waiting");

  // Something changed: the job being gathered is closed at once and another starts.
  const b = remember(await ask("c1", spec({ prompt: "a blue fox" })));
  const c = remember(await ask("c1", spec({ prompt: "a green fox" })));
  ok(b.key !== c.key && (await itemOf(b.key)).state === "waiting", "a click with a changed prompt closes the job before it and starts another");
  const d = remember(await ask("c2", spec({ prompt: "a green fox" })));
  ok(d.key !== c.key && (await itemOf(c.key)).state === "waiting", "…so does one for another chapter");

  // At most 8 pictures to a job.
  await sleep(1000);
  let last;
  for (let i = 0; i < 9; i++) last = remember(await ask("c3", spec({ prompt: "many foxes" })));
  const first = await itemOf(made.at(-9));
  ok(first.data.count === 8 && last.data.count === 1 && last.key !== first.key, "the ninth click starts another job after eight");

  // Batching off: each click is its own job.
  await sleep(1000);
  const x = remember(await ask("c4", spec({}, { batchClicks: false })));
  const y = remember(await ask("c4", spec({}, { batchClicks: false })));
  ok(x.key !== y.key && x.data.count === 1 && y.data.count === 1, "with batching off, each click is its own job");

  // A session's job keeps its session and base, and a temporary one says so.
  await sleep(1000);
  const s = remember(await ask("c5", spec({ session: "sess1", base: "saved:c5:header", temporary: true })));
  ok(s.data.session === "sess1" && s.data.base === "saved:c5:header" && s.data.view.temporary === true, "a Refine job keeps its session, base picture and temporary mark");

  // Refusals.
  ok((await call("POST", "/api/queue/pictures", { target: { kind: "chapter" }, spec: spec(), view: {} })).status === 400, "a target that does not fit is refused");
  ok((await call("POST", "/api/queue/pictures", { target: target("c1"), view: {} })).status === 400, "a request with no spec is refused");
  ok((await call("POST", "/api/queue/pictures", { target: target("c1"), spec: { prompt: "x" }, view: {} })).status === 400, "a spec that is not a picture job is refused");
} finally {
  await sleep(900);
  for (const key of made) await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(key)}`);
  await call("PUT", "/api/queue/paused", { paused: false });
}

// ---- sending: the jobs go to a fake ComfyUI one after another, are waited for and recorded ----
import Database from "better-sqlite3";
import { startFakeComfy, makePng } from "../e2e/fakeComfy.mjs";

const comfy = await startFakeComfy({ port: 3561, steps: 2, stepDelay: 40 });
const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const sent = [];
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(40);
  }
};
const prompts = () => comfy.calls.filter((c) => c.path === "/prompt");
const promptOrder = (...words) => prompts().map((c) => words.find((w) => JSON.stringify(c.body).includes(w)));
try {
  const put = await call("PUT", "/api/settings", { ...(settingsBefore ?? {}), comfy: { ...(settingsBefore?.comfy ?? {}), url: comfy.url } });
  const settingsNow = put.json.settings;
  const story = await call("POST", "/api/stories", { title: "Send tale", chapter: { title: "Root", body: "b", choices: [] } });
  const { story_id: storyId, chapter_id: chapterId } = story.json;
  const real = (extra = {}, over = {}) => ({
    ...spec(),
    comfy: { ...settingsNow.comfy, url: comfy.url, batchClicks: true, ...over },
    draw: { ...settingsNow.comfy.drawPresets[0], checkpoint: "fake_sdxl_a.safetensors" },
    seed: 5,
    ...extra,
  });
  const realTarget = { kind: "chapter", storyId, chapterId };
  const post = async (s, target = realTarget) => {
    const r = await call("POST", "/api/queue/pictures", { target, spec: s, view: { label: "Header", moment: "header" } });
    if (r.json?.item) sent.push(r.json.item.key);
    return r;
  };
  const stateOf = async (key) => (await itemOf(key))?.state;
  const jobsOf = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).json.jobs;

  // One job of two pictures from two quick clicks: sent, waited for, recorded once.
  let a = (await post(real({ prompt: "prompt-a" }))).json.item;
  await post(real({ prompt: "prompt-a" }));
  ok(!!(await until(async () => (await stateOf(a.key)) === "done")), "a closed job is sent to ComfyUI and waited for");
  let done = await itemOf(a.key);
  ok(done.data.count === 2 && done.data.pictures.length === 2 && done.data.pictures[0].prompt === "prompt-a" && done.data.unseen === true, "…it ends done with its two pictures, not seen yet");
  ok(done.data.promptId && prompts().length === 1 && prompts()[0].body.extra_data.storytime.job.prompt === "prompt-a", "…ComfyUI's id for it is kept, and it was sent once with the job's tag");
  let jobs = await jobsOf();  ok(jobs.length === 1 && jobs[0].images.length === 2 && jobs[0].prompt_id === done.data.promptId, "…and the log has the job once");
  ok(done.data.pictures[0].jobId === jobs[0].id, "…its pictures name the recorded job");

  // Two different jobs go one after another, in the order asked.
  const before = prompts().length;
  const b = (await post(real({ prompt: "prompt-b" }))).json.item;
  const c = (await post(real({ prompt: "prompt-c" }))).json.item;
  ok(!!(await until(async () => (await stateOf(b.key)) === "done" && (await stateOf(c.key)) === "done")), "two different jobs both finish");
  ok(promptOrder("prompt-b", "prompt-c").slice(before).join() === "prompt-b,prompt-c", "…and went to ComfyUI in the order they were asked");

  // Dismiss.
  ok((await call("DELETE", `/api/queue/items/${encodeURIComponent(b.key)}`)).status === 200 && !(await itemOf(b.key)), "a finished job can be dismissed");
  ok((await call("DELETE", "/api/queue/items/job-nosuch")).status === 404, "…and dismissing one that is not there is a 404");

  // Pause holds jobs; Move reorders them; resume sends in the new order.
  await call("PUT", "/api/queue/paused", { paused: true });
  const d = (await post(real({ prompt: "prompt-d" }))).json.item;
  await sleep(900);
  const e = (await post(real({ prompt: "prompt-e" }))).json.item;
  await sleep(900);
  // (A target's own jobs keep their order, so the job that moves is for another target: the story's cover.)
  const f = (await post(real({ prompt: "prompt-f", moment: "cover" }), { kind: "cover", storyId })).json.item;
  await sleep(900);
  const heldFrom = prompts().length;
  ok((await stateOf(d.key)) === "waiting" && (await stateOf(f.key)) === "waiting" && prompts().length === heldFrom, "a paused queue sends nothing");
  ok((await call("POST", `/api/queue/items/${encodeURIComponent(f.key)}`, { action: "move", how: "next" })).json.moved === true, "a waiting job can be moved to the front");
  ok((await call("POST", `/api/queue/items/${encodeURIComponent(f.key)}`, { action: "move", how: "up" })).json.moved === false, "…moving the first one up changes nothing");
  ok((await call("POST", `/api/queue/items/${encodeURIComponent(a.key)}`, { action: "move", how: "up" })).status === 409, "…and a job that is not waiting cannot be moved");
  await call("PUT", "/api/queue/paused", { paused: false });
  ok(!!(await until(async () => (await stateOf(d.key)) === "done" && (await stateOf(e.key)) === "done" && (await stateOf(f.key)) === "done")), "resumed, they all finish");
  ok(promptOrder("prompt-d", "prompt-e", "prompt-f").slice(heldFrom).join() === "prompt-f,prompt-d,prompt-e", "…in the order they were moved to");

  // A starting picture the browser uploaded reaches ComfyUI with the same bytes.
  const bytes = makePng(3);
  const up = await fetch(`${B}/api/queue/uploads`, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes });
  const source = (await up.json()).source;
  const g = (await post(real({ prompt: "prompt-g", start: { key: "upload:picked", source } }))).json.item;
  ok(!!(await until(async () => ["done", "failed"].includes(await stateOf(g.key)))), "a job with a picked starting picture ends");
  const gDone = await itemOf(g.key);
  const sentUp = comfy.calls.filter((x) => x.path === "/upload/image").at(-1);
  const uploadedName = gDone.data.pictures?.[0] ? prompts().at(-1).body.prompt && JSON.stringify(prompts().at(-1).body.prompt).match(/storytime[^"]*\.png|[\w-]+\.png/g)?.find((n) => comfy.uploaded(n)) : null;
  ok(gDone.state === "done" && !!sentUp, `…the picture is uploaded to ComfyUI (${gDone.data.message ?? gDone.state})`);
  ok(!!uploadedName && Buffer.compare(comfy.uploaded(uploadedName).subarray(0, bytes.length), Buffer.from(bytes)) === 0, "…with the bytes the browser sent");
  ok(gDone.data.pictures[0].source === source, "…and the log's source is the upload");

  // A job ComfyUI fails ends failed with its message.
  comfy.setMode({ fail: "error" });
  const h = (await post(real({ prompt: "prompt-h" }))).json.item;
  ok(!!(await until(async () => (await stateOf(h.key)) === "failed")), "a job that fails in ComfyUI ends failed");
  ok(/couldn't make the pictures/.test((await itemOf(h.key)).data.message ?? ""), "…with ComfyUI's message");
  comfy.setMode({ fail: null });

  // Stop takes a sent job off ComfyUI.
  comfy.setMode({ steps: 8, stepDelay: 200 });
  const i = (await post(real({ prompt: "prompt-i" }))).json.item;
  ok(!!(await until(async () => (await itemOf(i.key))?.data.promptId)), "a job being made has ComfyUI's id");
  const callsBefore = comfy.calls.length;
  ok((await call("POST", `/api/queue/items/${encodeURIComponent(i.key)}`, { action: "stop" })).status === 200, "a job being made can be stopped");
  ok(!!(await until(async () => !(await itemOf(i.key)))), "…it leaves the queue");
  ok(comfy.calls.slice(callsBefore).some((x) => x.path === "/interrupt" || x.path === "/queue"), "…and was taken off ComfyUI");
  ok((await jobsOf()).every((j) => !JSON.stringify(j).includes("prompt-i")), "…and nothing was recorded for it");
  comfy.setMode({ steps: 2, stepDelay: 40 });

  // A waiting job can be stopped too.
  await call("PUT", "/api/queue/paused", { paused: true });
  const j = (await post(real({ prompt: "prompt-j" }))).json.item;
  await sleep(900);
  ok((await call("POST", `/api/queue/items/${encodeURIComponent(j.key)}`, { action: "stop" })).status === 200 && !(await itemOf(j.key)), "a waiting job can be stopped");
  await call("PUT", "/api/queue/paused", { paused: false });
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  for (const key of sent) await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(key)}`);
  await comfy.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
