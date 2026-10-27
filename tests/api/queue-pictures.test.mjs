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
  moment: "header",
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
