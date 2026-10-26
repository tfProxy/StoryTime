// The worker's bus and the server-sent events helper.
import { createBus, workerState } from "../../src/lib/worker/bus.ts";
import { sseResponse } from "../../src/lib/worker/sse.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- the bus ----
const bus = createBus();
const got: unknown[] = [];
const stopA = bus.subscribe("x", (e) => got.push(["a", e]));
bus.subscribe("x", () => { throw new Error("a broken listener"); });
bus.subscribe("x", (e) => got.push(["c", e]));
bus.subscribe("y", (e) => got.push(["y", e]));
bus.publish("x", 1);
ok(JSON.stringify(got) === '[["a",1],["c",1]]', "an event goes to every listener of its channel, and a broken one does not stop the rest");
stopA();
bus.publish("x", 2);
ok(JSON.stringify(got.slice(2)) === '[["c",2]]', "a listener that stopped hears nothing more");
bus.publish("nobody", 3);
ok(got.length === 3, "publishing on a channel nobody listens to does nothing");

// one state per process, held on globalThis
ok(workerState() === workerState() && workerState() === globalThis.__storytimeWorker, "the worker state is one object on globalThis");

// ---- sse ----
const controller = new AbortController();
const request = new Request("http://localhost/x", { signal: controller.signal });
let stopped = 0;
let send: ((e: unknown) => void) | null = null;
const res = sseResponse(request, (s) => { send = s; s({ hello: 1 }); return () => { stopped++; }; }, { pingMs: 30 });
ok(res.headers.get("content-type")?.startsWith("text/event-stream") === true, "the response is an event stream");
ok(res.headers.get("cache-control") === "no-cache, no-transform" && res.headers.get("x-accel-buffering") === "no", "…not cached or buffered");

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let text = "";
const readUntil = async (re: RegExp, ms = 1000) => {
  const stop = Date.now() + ms;
  while (!re.test(text) && Date.now() < stop) {
    const r = await Promise.race([reader.read(), new Promise<null>((x) => setTimeout(() => x(null), stop - Date.now()))]);
    if (!r || r.done) break;
    text += decoder.decode(r.value, { stream: true });
  }
  return re.test(text);
};
ok(await readUntil(/data: \{"hello":1\}\n\n/), "what subscribe sends first arrives");
ok(text.startsWith(": connected\n\n"), "…after a comment that opens the stream");
send!({ later: [1, 2] });
ok(await readUntil(/data: \{"later":\[1,2\]\}\n\n/), "a later event arrives as it is sent");
ok(await readUntil(/: ping\n\n/), "a comment line is sent now and then");
controller.abort();
await new Promise((r) => setTimeout(r, 20));
ok(stopped === 1, "the subscription is stopped when the client goes away");
const end = await reader.read().catch(() => ({ done: true }));
ok(end.done === true, "…and the stream ends");
send!({ afterwards: true }); // must not throw

// A request that is already aborted opens nothing.
const dead = new AbortController();
dead.abort();
let started = 0;
const res2 = sseResponse(new Request("http://localhost/x", { signal: dead.signal }), () => { started++; return () => {}; });
const r2 = await res2.body!.getReader().read();
ok(started === 0 && r2.done === true, "a request that is already aborted is not subscribed");

// Cancelling the body (the client closed) stops the subscription too.
let stopped3 = 0;
const res3 = sseResponse(new Request("http://localhost/x"), () => () => { stopped3++; }, { pingMs: 1000 });
const reader3 = res3.body!.getReader();
await reader3.read();
await reader3.cancel();
ok(stopped3 === 1, "cancelling the body stops the subscription");
