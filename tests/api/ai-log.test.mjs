// The prompt history: a record the browser posts is stored, listed and fetched by id; a run on the server against the
// (fake) AI is recorded as "Codex check" with its run id, model and reply; and no API key is in any stored row.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(50);
  }
};

const KEY = "SECRET-FAKE-KEY-4242";
const ai = await startFakeAi({
  port: 3580,
  delay: 5,
  reply: (body) => {
    if (!JSON.stringify(body).includes("You keep the codex of a story up to date")) return "A reply.";
    return JSON.stringify({ changes: [{ kind: "set", entry: "Mira", aspect: "Ears", text: "Tall russet fox ears.", quote: "My ears are tall and russet now" }] });
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
try {
  // ---- a call the browser made ----
  const record = {
    at: Date.now() - 1000, ms: 840, source: "Write ahead", storyId: "story-x", chapterId: "chap-x", connection: "My Ollama", model: "llama3", role: "main",
    temperature: 0.7, thinkingOff: true, system: "You are a writer.", messages: [{ role: "user", content: "Write something." }], reply: "Once upon a time.", status: "ok",
  };
  let r = await call("POST", "/api/ai-log", record);
  ok(r.status === 201 && typeof r.json.id === "string", "a browser record is accepted");
  const browserId = r.json.id;
  let list = (await call("GET", "/api/ai-log?source=Write%20ahead")).json;
  const row = list.calls.find((c) => c.id === browserId);
  ok(!!row && row.side === "browser" && row.model === "llama3" && row.ms === 840 && row.status === "ok" && row.story_id === "story-x" && row.chapter_id === "chap-x", "…and listed, as a browser call");
  ok(!("reply" in row) && !("system" in row) && !("messages" in row), "…without its texts");
  ok(list.sources.includes("Write ahead"), "…and its label is in the sources");
  r = await call("GET", `/api/ai-log/${browserId}`);
  const full = r.json.call;
  ok(r.status === 200 && full.system === "You are a writer." && full.reply === "Once upon a time." && full.messages[0].content === "Write something." && full.connection === "My Ollama" && full.thinking_off === true && full.temperature === 0.7 && full.role === "main", "…and fetched whole by id");
  ok((await call("GET", "/api/ai-log/nope")).status === 404, "an unknown id is a 404");

  r = await call("POST", "/api/ai-log", { ...record, source: undefined, status: "failed", error: "boom" });
  const failedId = r.json.id;
  ok((await call("GET", `/api/ai-log/${failedId}`)).json.call.source === "Other", "a record with no label is 'Other'");
  list = (await call("GET", "/api/ai-log?failed=1")).json;
  ok(list.calls.length >= 1 && list.calls.every((c) => c.status === "failed") && list.calls.some((c) => c.id === failedId), "failed=1 lists failed calls only");
  ok((await call("GET", "/api/ai-log?chapter=chap-x&story=story-x&limit=1")).json.calls.length === 1, "chapter, story and limit filters work");

  ok((await call("POST", "/api/ai-log", { ...record, status: "weird" })).status === 400, "a bad status is refused");
  ok((await call("POST", "/api/ai-log", { ...record, messages: "x" })).status === 400, "bad messages are refused");
  ok((await call("POST", "/api/ai-log", "not json")).status === 400, "a body that is not JSON is refused");
  ok((await call("POST", "/api/ai-log", { ...record, reply: "x".repeat(2_500_000) })).status === 400, "a text over the field cap is refused");
  ok((await call("POST", "/api/ai-log", "x".repeat(4_500_000))).status === 413, "an oversized body is refused");

  // ---- a call the server made: a codex check in a review run ----
  const put = await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake AI", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: KEY, freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "fake-main" }, cheap: { connectionId: "c1", model: "fake-cheap" } },
    autoCodex: false,
  });
  ok(put.status === 200, "settings with the fake AI are saved");
  const s = await call("POST", "/api/stories", { title: "History", premise: "P", chapter: { title: "Root", body: "Mira waited.", summary: "s", choices: ["Go"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect: "Ears", text: "Human ears." });
  const kid = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${root}`)).json.choices[0].id, title: "Child", body: 'Mira touched her head. "My ears are tall and russet now," she said.', summary: "s" })).json.chapter_id;
  const run = (await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: kid, mode: "review", options: { tagScope: "chapter", checks: ["codex"] } })).json.id;
  runs.push(run);
  await call("POST", `/api/ai-runs/${run}/queue`);
  const itemOf = async () => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
  ok(!!(await until(async () => (await itemOf())?.state === "done")), "the worker takes the run to the end");

  list = (await call("GET", `/api/ai-log?run=${run}`)).json;
  ok(list.calls.length === 1, "the run made one recorded call: " + list.calls.length);
  const check = list.calls[0];
  ok(check.source === "Codex check" && check.side === "server" && check.run_id === run && check.chapter_id === kid && check.story_id === story && check.story_title === "History", "…labelled Codex check, with the run, chapter and story");
  ok(check.model === "fake-cheap" && check.connection === "Fake AI" && check.role === "cheap" && check.status === "ok", "…with the model, the connection's name and the role");
  const checkFull = (await call("GET", `/api/ai-log/${check.id}`)).json.call;
  ok(checkFull.system.includes("You keep the codex of a story up to date") && checkFull.messages[0].content.includes("My ears are tall and russet now") && checkFull.reply.includes("Tall russet fox ears.") && checkFull.ms >= 0, "…with the prompt and the reply");
  ok((await call("GET", `/api/ai-log?source=${encodeURIComponent("Codex check")}`)).json.calls.some((c) => c.id === check.id), "…and the label filter finds it");
  await call("DELETE", `/api/queue/items/run:${run}`);

  // ---- the key is nowhere ----
  const all = (await call("GET", "/api/ai-log")).json.calls;
  const wholes = [];
  for (const c of all) wholes.push((await call("GET", `/api/ai-log/${c.id}`)).json.call);
  ok(wholes.length >= 3 && !JSON.stringify(wholes).includes(KEY), "no API key is in any stored call (through the API)");
  const raw = new Database(process.env.TEST_DB, { readonly: true });
  const dump = JSON.stringify(raw.prepare("SELECT * FROM ai_calls_v1").all());
  raw.close();
  ok(dump.length > 100 && !dump.includes(KEY), "…nor in the table itself");
} finally {
  for (const id of runs) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
