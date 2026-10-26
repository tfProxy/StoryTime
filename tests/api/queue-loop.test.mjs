// The worker's loop, writing only: a posted Generate is taken up in its turn, written into the draft through the fake
// AI, and its events arrive; Stop keeps the text so far; a paused queue starts nothing; Generates go one at a time.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 8000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(50);
  }
};

// Follows a server-sent stream; `seen` collects every data event.
function follow(url) {
  const ctl = new AbortController();
  const seen = [];
  (async () => {
    const res = await fetch(B + url, { signal: ctl.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.startsWith("data: ")) seen.push(JSON.parse(frame.slice(6)));
      }
    }
  })().catch(() => {});
  return { seen, close: () => ctl.abort() };
}

const chapter = "# The Door\n\nShe opened it and went in.";
const ai = await startFakeAi({ port: 3559, delay: 5, reply: chapter });

const draftOf = (key) => call("GET", `/api/drafts/${encodeURIComponent(key)}`).then((r) => r.json?.draft);
const request = (key, extra = {}) => ({
  key,
  href: "/stories/s1/chapters/c1/write",
  label: key,
  ctx: { storyTitle: "Story", premise: "p", path: [] },
  direction: "go on",
  length: "short",
  model: null,
  suggestModel: null,
  after: { choiceText: false, suggestChoices: false },
  base: { title: "", body: "" },
  draft: { key, href: "/stories/s1/chapters/c1/write", label: key, updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "", title: "", body: "", choices: [""], prompt: "", undo: [] },
  ...extra,
});
const itemOf = async (key) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `gen:${key}`);

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const queue = follow("/api/queue/events");
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
  });

  // One Generate, start to end.
  const one = follow(`/api/queue/generate/events?key=${encodeURIComponent("fill:loop-a")}`);
  await sleep(100);
  await call("POST", "/api/queue/generate", request("fill:loop-a"));
  ok(!!(await until("done", async () => (await itemOf("fill:loop-a"))?.state === "done")), "a posted Generate is taken up and finishes");
  ok(one.seen.some((e) => e.type === "text") && one.seen.at(-1)?.type === "done", "its events show the text, then the end");
  one.close();
  const d = await draftOf("fill:loop-a");
  ok(d?.title === "The Door" && d.body === "She opened it and went in.", "the chapter is saved in the draft on the server");
  ok(queue.seen.some((e) => e.type === "item" && e.item.key === "gen:fill:loop-a" && e.item.state === "working"), "the queue's events showed it working");
  ok(queue.seen.some((e) => e.type === "machine" && Array.isArray(e.waiting) && e.paused === false), "…and the machine's state");

  // Paused: nothing starts; resumed: it does.
  await call("PUT", "/api/queue/paused", { paused: true });
  await call("POST", "/api/queue/generate", request("fill:loop-b"));
  await sleep(600);
  ok((await itemOf("fill:loop-b"))?.state === "waiting" && (await draftOf("fill:loop-b")) === undefined, "a paused queue starts nothing");
  ok(queue.seen.some((e) => e.type === "machine" && e.paused === true), "…and says it is paused");
  await call("PUT", "/api/queue/paused", { paused: false });
  ok(!!(await until("done", async () => (await itemOf("fill:loop-b"))?.state === "done")), "resumed, it goes");

  // Two at once: one at a time, in the order asked.
  ai.setDelay(120);
  await call("POST", "/api/queue/generate", request("fill:loop-c"));
  await call("POST", "/api/queue/generate", request("fill:loop-d"));
  await until("c working", async () => (await itemOf("fill:loop-c"))?.state === "working");
  const second = await itemOf("fill:loop-d");
  ok(second?.state === "waiting", "a second Generate waits for the first");
  ok(!!(await until("note", async () => (await itemOf("fill:loop-d"))?.data.note === "Waiting for the step in progress")), "…and says why");
  ok(!!(await until("d done", async () => (await itemOf("fill:loop-d"))?.state === "done")) && (await itemOf("fill:loop-c"))?.state === "done", "…then goes, after the first");

  // Stop keeps the text so far.
  await call("POST", "/api/queue/generate", request("fill:loop-e"));
  await until("e text", async () => (await itemOf("fill:loop-e"))?.state === "working");
  await sleep(150);
  ok((await call("DELETE", "/api/queue/generate?key=fill:loop-e")).status === 200, "a Generate that is going can be stopped");
  ok(!!(await until("gone", async () => !(await itemOf("fill:loop-e")))), "…it leaves the queue");
  const partial = await draftOf("fill:loop-e");
  ok(!!partial && partial.body.length > 0 && partial.body.length < "She opened it and went in.".length, `…and the text so far is in the draft (${JSON.stringify(partial?.body)})`);
} finally {
  queue.close();
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  for (const k of ["a", "b", "c", "d", "e"]) await call("DELETE", `/api/drafts/${encodeURIComponent(`fill:loop-${k}`)}`);
  // Other API test files expect that no settings have been saved yet.
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
