// The work queue on the server: the item list, and the events stream, which must deliver each change as it
// happens (not held back until the stream ends or fills a buffer).
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// Reads a server-sent events body: next() answers the next data event (parsed), or null after `ms` with none.
function events(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames = [];
  const comments = [];
  const pull = async () => {
    const { value, done } = await reader.read();
    if (done) return false;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (frame.startsWith("data: ")) frames.push(JSON.parse(frame.slice(6)));
      else if (frame.startsWith(":")) comments.push(frame);
    }
    return true;
  };
  return {
    comments,
    async next(ms = 1000) {
      const stop = Date.now() + ms;
      while (frames.length === 0) {
        const left = stop - Date.now();
        if (left <= 0) return null;
        const more = await Promise.race([pull(), new Promise((r) => setTimeout(() => r("timeout"), left))]);
        if (more === "timeout" || more === false) return frames.shift() ?? null;
      }
      return frames.shift();
    },
    cancel: () => reader.cancel().catch(() => {}),
  };
}

const KEY = "gen:queue-test";

// the list
let r = await call("GET", "/api/queue");
ok(r.status === 200 && Array.isArray(r.json.items), "GET /api/queue lists the items");
ok(!r.json.items.some((i) => i.key === KEY), "…which has no test item yet");

// the stream
const controller = new AbortController();
const res = await fetch(B + "/api/queue/events", { signal: controller.signal });
ok(res.status === 200 && /^text\/event-stream/.test(res.headers.get("content-type") ?? ""), "the events route answers as an event stream");
ok(/no-cache/.test(res.headers.get("cache-control") ?? "") && res.headers.get("x-accel-buffering") === "no", "…told not to be cached or buffered");
const stream = events(res);
// the next event about an item (the loop also sends "machine" events after each change)
const nextChange = async () => {
  for (let e = await stream.next(); e; e = await stream.next()) if (e.type !== "machine") return e;
  return null;
};
const first = await stream.next();
ok(first?.type === "items" && Array.isArray(first.items), "the first event lists every item");

// a change arrives while the stream is open, within a second
let t = Date.now();
r = await call("POST", "/api/queue/test-items", { key: KEY });
ok(r.status === 201 && r.json.key === KEY && r.json.state === "waiting", "a test item is made");
let evt = await nextChange();
ok(evt?.type === "item" && evt.item.key === KEY && evt.item.state === "waiting", "…and an item event arrives");
ok(Date.now() - t < 1000, `…at once, not held back (${Date.now() - t} ms)`);

t = Date.now();
r = await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(KEY)}`);
ok(r.json?.removed === true, "the test item is removed");
evt = await nextChange();
ok(evt?.type === "removed" && evt.key === KEY && Date.now() - t < 1000, "…and a removed event arrives");

// a second stream gets the current list first, and a closed one doesn't hold up the others
const second = events(await fetch(B + "/api/queue/events"));
ok((await second.next())?.type === "items", "a second stream starts with the list too");
await second.cancel();
await call("POST", "/api/queue/test-items", { key: KEY });
evt = await nextChange();
ok(evt?.type === "item" && evt.item.key === KEY, "a stream still gets changes after another one closed");
await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(KEY)}`);

controller.abort();
await stream.cancel();
r = await call("GET", "/api/health");
ok(r.status === 200, "the server is fine after the streams closed");
r = await call("GET", "/api/queue");
ok(!r.json.items.some((i) => i.key === KEY), "no test item is left behind");

ok((await call("POST", "/api/queue/test-items", {})).status === 400, "a test item needs a key");

// "Seen": the owner has looked at a finished run or Generate. It stays in the list, marked, and is not "ready" any more.
{
  const itemOf = async (key) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === key);
  const seen = (key) => call("POST", `/api/queue/items/${encodeURIComponent(key)}`, { action: "seen" });
  const runData = { runId: "seen-run", storyId: "s1", storyTitle: "Tale", startChapterId: null, startTitle: "", mode: "fill", done: 2, total: 2 };
  const keys = ["run:seen-run", "run:seen-going", "gen:seen-gen", "seen-picture"];
  await call("POST", "/api/queue/test-items", { key: keys[0], type: "run", state: "done", data: runData });
  await call("POST", "/api/queue/test-items", { key: keys[1], type: "run", state: "paused", data: { ...runData, runId: "seen-going" } });
  await call("POST", "/api/queue/test-items", { key: keys[2], type: "generate", state: "done", data: { draftKey: "seen-gen", href: "/test", label: "Test", request: {} } });
  await call("POST", "/api/queue/test-items", { key: keys[3], type: "picture", state: "done", data: { target: { kind: "chapter", storyId: "s1", chapterId: "c1" }, spec: {}, count: 1, view: {} } });
  ok(!("seen" in (await itemOf(keys[0])).data), "a finished run starts not seen");

  r = await seen(keys[0]);
  ok(r.status === 200 && r.json.ok === true, "a finished run can be marked seen");
  let item = await itemOf(keys[0]);
  ok(item?.state === "done" && item.data.seen === true && item.data.done === 2, "…it stays in the list, still done, now marked seen");
  ok((await seen(keys[0])).status === 200, "…marking it again is fine");
  r = await seen(keys[2]);
  item = await itemOf(keys[2]);
  ok(r.status === 200 && item?.state === "done" && item.data.seen === true, "a finished Generate can be marked seen too");

  r = await seen(keys[1]);
  ok(r.status === 409 && !("seen" in (await itemOf(keys[1])).data), "a run that has not finished cannot be marked seen");
  r = await seen(keys[3]);
  ok(r.status === 409 && !("seen" in (await itemOf(keys[3])).data), "a picture job cannot be marked seen");
  ok((await seen("gen:nothing-here")).status === 404, "an item that is not there is a 404");
  r = await call("POST", `/api/queue/items/${encodeURIComponent(keys[0])}`, { action: "nonsense" });
  ok(r.status === 400 && /seen/.test(r.json.error), "an unknown action is refused, and the message names “seen”");

  // A Generate asked for again is a new item, so it is not seen until it ends again.
  await call("PUT", "/api/queue/paused", { paused: true });
  const draft = "queue-seen-draft";
  const request = {
    key: draft, href: "/test", label: "Again", ctx: { storyTitle: "Story", premise: "p", path: [] }, direction: "go on", length: "short", model: null, suggestModel: null,
    after: { choiceText: false }, base: { title: "", body: "" },
    draft: { key: draft, href: "/test", label: "Again", updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "", title: "", body: "", choices: [""], prompt: "", undo: [] },
  };
  await call("POST", "/api/queue/test-items", { key: `gen:${draft}`, type: "generate", state: "done", data: { draftKey: draft, href: "/test", label: "Again", request: {} } });
  await seen(`gen:${draft}`);
  ok((await itemOf(`gen:${draft}`)).data.seen === true, "a finished Generate is seen");
  await call("POST", "/api/queue/generate", request);
  item = await itemOf(`gen:${draft}`);
  ok(item?.state === "waiting" && !("seen" in item.data), "…and asking for it again makes a waiting item that is not seen");
  await call("DELETE", `/api/queue/generate?key=${encodeURIComponent(draft)}`);
  await call("PUT", "/api/queue/paused", { paused: false });

  for (const key of keys) await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(key)}`);
  ok(!(await call("GET", "/api/queue")).json.items.some((i) => i.key.includes("seen")), "no seen-test items are left behind");
}
