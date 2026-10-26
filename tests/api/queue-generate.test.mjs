// The Generate routes: ask, list, stop, and the events stream. (Running a Generate is the loop's job, tested with it.)
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const key = "fill:api-generate";
const request = {
  key,
  href: "/stories/s1/chapters/c1/write",
  label: "A chapter",
  ctx: { storyTitle: "Story", premise: "p", path: [] },
  direction: "go on",
  length: "short",
  model: null,
  suggestModel: null,
  after: { choiceText: false, suggestChoices: false },
  base: { title: "", body: "" },
  draft: { key, href: "/stories/s1/chapters/c1/write", label: "A chapter", updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "", title: "", body: "", choices: [""], prompt: "", undo: [] },
};

// Paused, so the loop leaves the Generate waiting.
await call("PUT", "/api/queue/paused", { paused: true });
let r = await call("POST", "/api/queue/generate", { ...request, length: "huge" });
ok(r.status === 400 && typeof r.json.error === "string", "a request that does not fit is refused");
r = await call("POST", "/api/queue/generate", "nonsense");
ok(r.status === 400, "…as is a body that is not a request");

r = await call("POST", "/api/queue/generate", request);
ok(r.status === 201 && r.json.item.key === `gen:${key}` && r.json.item.type === "generate" && r.json.item.state === "waiting", "a Generate is accepted as a waiting item");
ok(r.json.item.data.draftKey === key && r.json.item.data.label === "A chapter", "…naming its draft");
const listed = (await call("GET", "/api/queue")).json.items.find((i) => i.key === `gen:${key}`);
ok(listed?.state === "waiting", "…which the queue lists");
r = await call("POST", "/api/queue/generate", request);
ok(r.status === 201 && r.json.item.createdAt === listed.createdAt, "asking again for the same draft changes nothing");

const events = await fetch(`${B}/api/queue/generate/events?key=${encodeURIComponent(key)}`);
ok(events.status === 200 && (events.headers.get("content-type") ?? "").startsWith("text/event-stream"), "its events are a server-sent stream");
await events.body.cancel();
ok((await fetch(`${B}/api/queue/generate/events`)).status === 400, "the events stream needs a key");

ok((await call("DELETE", "/api/queue/generate")).status === 400, "stopping needs a key");
r = await call("DELETE", `/api/queue/generate?key=${encodeURIComponent(key)}`);
ok(r.status === 200, "a waiting Generate can be stopped");
ok(!(await call("GET", "/api/queue")).json.items.some((i) => i.key === `gen:${key}`), "…and is no longer listed");
ok((await call("DELETE", `/api/queue/generate?key=${encodeURIComponent(key)}`)).status === 404, "stopping one that is not there is a 404");
await call("PUT", "/api/queue/paused", { paused: false });
