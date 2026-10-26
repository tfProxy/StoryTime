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
const first = await stream.next();
ok(first?.type === "items" && Array.isArray(first.items), "the first event lists every item");

// a change arrives while the stream is open, within a second
let t = Date.now();
r = await call("POST", "/api/queue/test-items", { key: KEY });
ok(r.status === 201 && r.json.key === KEY && r.json.state === "waiting", "a test item is made");
let evt = await stream.next();
ok(evt?.type === "item" && evt.item.key === KEY && evt.item.state === "waiting", "…and an item event arrives");
ok(Date.now() - t < 1000, `…at once, not held back (${Date.now() - t} ms)`);

t = Date.now();
r = await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(KEY)}`);
ok(r.json?.removed === true, "the test item is removed");
evt = await stream.next();
ok(evt?.type === "removed" && evt.key === KEY && Date.now() - t < 1000, "…and a removed event arrives");

// a second stream gets the current list first, and a closed one doesn't hold up the others
const second = events(await fetch(B + "/api/queue/events"));
ok((await second.next())?.type === "items", "a second stream starts with the list too");
await second.cancel();
await call("POST", "/api/queue/test-items", { key: KEY });
evt = await stream.next();
ok(evt?.type === "item" && evt.item.key === KEY, "a stream still gets changes after another one closed");
await call("DELETE", `/api/queue/test-items?key=${encodeURIComponent(KEY)}`);

controller.abort();
await stream.cancel();
r = await call("GET", "/api/health");
ok(r.status === 200, "the server is fine after the streams closed");
r = await call("GET", "/api/queue");
ok(!r.json.items.some((i) => i.key === KEY), "no test item is left behind");

ok((await call("POST", "/api/queue/test-items", {})).status === 400, "a test item needs a key");
