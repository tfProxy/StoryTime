// AI runs on the server: a posted run is put in line and the worker writes its chapters (through the fake AI); Stop
// pauses it, queueing again finishes it; Skip works with the worker's lease; the run's events stream.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";
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
    await sleep(50);
  }
};
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

// A fake AI that answers a plan (a direction for each given choice), a chapter, or a summary, by what the request is.
let chapters = 0;
const ai = await startFakeAi({
  port: 3560,
  delay: 5,
  reply: (body) => {
    const sent = JSON.stringify(body);
    const message = body.messages?.at(-1)?.content ?? "";
    if (sent.includes("skilled fiction co-author")) return `# Chapter ${++chapters}\n\nText of chapter ${chapters}.`;
    if (sent.includes("You reply with a JSON array and nothing else")) {
      const given = [...(message.match(/These choices are offered at its end: ([^\n]*?)\.\n/)?.[1].matchAll(/“([^”]+)”/g) ?? [])].map((x) => x[1]);
      return JSON.stringify(given.map((choice) => ({ choice, direction: `plan for ${choice}` })));
    }
    if (sent.includes("turn a chapter of a story into a prompt")) return JSON.stringify({ scene: "A door", prompt: "an open door, warm light", negative: "blurry" });
    return "SUMMARY:\nA short summary.\nSTORY SO FAR:\nThe story so far.";
  },
});
const comfy = await startFakeComfy({ port: 3563, steps: 2, stepDelay: 40 });

// A story with two open choices, and a fill run for both.
async function makeRun(name) {
  const s = await call("POST", "/api/stories", { title: name, premise: "A premise", chapter: { title: "Root", body: "root body", summary: "root sum", choices: ["Go left", "Go right"] } });
  const { story_id: story, chapter_id: root } = s.json;
  const [left, right] = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const write = (id, choice) => ({ kind: "write", id, slot: { kind: "choice", choiceId: choice.id }, label: choice.label, direction: "", depth: 1, choices: { given: [], suggest: 0 }, plannedBy: "t1", expand: false, status: "todo" });
  const tasks = [{ kind: "plan", id: "t1", chapterId: root, depth: 0, labels: ["Go left", "Go right"], add: 0, status: "todo" }, write("t2", left), write("t3", right)];
  const r = await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: root, mode: "fill", options: { models: "each", endChoices: 0 }, tasks });
  return { run: r.json.id, story, root };
}
const itemOf = async (run) => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`);
const runOf = async (run) => (await call("GET", `/api/ai-runs/${run}`)).json;

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
  });

  ok((await call("POST", "/api/ai-runs/nope/queue")).status === 404, "a run that does not exist cannot be queued");

  // A whole run.
  const a = await makeRun("Runs A");
  const events = follow(`/api/ai-runs/${a.run}/events`);
  let r = await call("POST", `/api/ai-runs/${a.run}/queue`);
  ok(r.status === 201 && r.json.item.key === `run:${a.run}` && r.json.item.type === "run" && r.json.item.data.total === 2 && r.json.item.data.storyTitle === "Runs A", "queueing a run makes a run item that names its story and counts its chapters");
  ok(!!(await until(async () => (await itemOf(a.run))?.state === "done")), "the worker writes the run to the end");
  const finished = await runOf(a.run);
  ok(finished.status === "done" && finished.tasks.every((t) => t.status === "done"), "…every task of the run is done");
  const children = (await call("GET", `/api/chapters/${a.root}`)).json.choices.map((c) => c.child_chapter_id);
  ok(children.length === 2 && children.every(Boolean), "…and both chapters are posted into the story");
  ok((await itemOf(a.run)).data.done === 2, "…the item counts both");
  await sleep(100);
  ok(events.seen[0]?.type === "run" && events.seen.some((e) => e.type === "event" && e.event.type === "taskDone") && events.seen.some((e) => e.type === "event" && e.event.type === "state" && e.event.status === "done"), "the run's events show it first, then the steps, then the end");
  events.close();

  // Stop pauses; queueing again finishes.
  ai.setDelay(250);
  const b = await makeRun("Runs B");
  await call("POST", `/api/ai-runs/${b.run}/queue`);
  ok(!!(await until(async () => (await itemOf(b.run))?.state === "working")), "a run in line is taken up");
  await sleep(300);
  ok((await call("DELETE", `/api/ai-runs/${b.run}/queue`)).status === 200, "a run that is going can be stopped");
  ok(!!(await until(async () => (await itemOf(b.run))?.state === "paused")) && (await runOf(b.run)).status === "paused", "…it is paused, in the queue and on the server");
  ai.setDelay(5);
  r = await call("POST", `/api/ai-runs/${b.run}/queue`);
  ok(r.status === 201 && ["waiting", "working"].includes(r.json.item.state), "queueing it again puts it back in line (and the worker may take it up at once)");
  ok(!!(await until(async () => (await itemOf(b.run))?.state === "done")) && (await runOf(b.run)).status === "done", "…and it finishes");
  ok((await call("DELETE", `/api/ai-runs/${b.run}/queue`)).status === 404, "a finished run cannot be stopped");

  // A waiting run can be paused without a step going.
  await call("PUT", "/api/queue/paused", { paused: true });
  const c = await makeRun("Runs C");
  await call("POST", `/api/ai-runs/${c.run}/queue`);
  await sleep(300);
  ok((await itemOf(c.run))?.state === "waiting", "a paused queue leaves a run waiting");
  ok((await call("DELETE", `/api/ai-runs/${c.run}/queue`)).status === 200 && (await itemOf(c.run))?.state === "paused" && (await runOf(c.run)).status === "paused", "…which can be stopped there");
  await call("PUT", "/api/queue/paused", { paused: false });

  // Skip.
  ok((await call("POST", `/api/ai-runs/${c.run}/task`, { taskId: "t3", action: "dance" })).status === 400, "a task action must be retry or skip");
  r = await call("POST", `/api/ai-runs/${c.run}/task`, { taskId: "t3", action: "skip" });
  ok(r.status === 200 && r.json.tasks.find((t) => t.id === "t3").status === "skipped", "a task can be skipped through the worker");

  // Fill missing pictures: the run writes the prompts, the picture queue draws, the picture is saved as the header.
  const now = (await call("GET", "/api/settings")).json.settings;
  const comfySettings = { ...now.comfy, url: comfy.url, drawPresets: now.comfy.drawPresets.map((p, i) => (i === 0 ? { ...p, checkpoint: "fake_sdxl_a.safetensors" } : p)) };
  await call("PUT", "/api/settings", { ...now, comfy: comfySettings });
  const pic = await makeRun("Pictures run");
  const made = await call("POST", "/api/ai-runs", {
    story_id: pic.story, start_chapter_id: null, mode: "pictures", options: {},
    tasks: [{ kind: "picture", id: "p1", chapterId: pic.root, slot: "header", label: "Root", status: "todo" }],
  });
  const picRun = made.json.id;
  ok((await call("POST", `/api/ai-runs/${picRun}/queue`)).status === 201, "a picture run is queued");
  ok(!!(await until(async () => (await itemOf(picRun))?.state === "done", 20000)), "…the worker writes its prompt, has the picture drawn and finishes");
  const picDone = await runOf(picRun);
  ok(picDone.status === "done" && picDone.tasks[0].status === "done" && picDone.tasks[0].prompt.includes("open door") && !!picDone.tasks[0].jobId, "…the task is done with the prompt and the picture job it used");
  const header = await fetch(`${B}/api/chapters/${pic.root}/images/header`);
  const bytes = Buffer.from(await header.arrayBuffer());
  ok(header.status === 200 && bytes[0] === 0xff && bytes[1] === 0xd8, "…and the picture is saved as the chapter's header, a JPEG");
  ok(!(await call("GET", "/api/queue")).json.items.some((i) => i.type === "picture" && i.data.session === `pictures:${picRun}`), "…and the run's picture job is not left in the queue");
  ok(comfy.calls.filter((x) => x.path === "/prompt").length === 1, "…it drew one picture");

  // A job that fails is asked for again once, then the run fails with ComfyUI's message.
  comfy.setMode({ fail: "error" });
  const bad = await makeRun("Failing pictures");
  const badRun = (await call("POST", "/api/ai-runs", {
    story_id: bad.story, start_chapter_id: null, mode: "pictures", options: {},
    tasks: [{ kind: "picture", id: "p1", chapterId: bad.root, slot: "header", label: "Root", status: "todo" }],
  })).json.id;
  const promptsBefore = comfy.calls.filter((x) => x.path === "/prompt").length;
  await call("POST", `/api/ai-runs/${badRun}/queue`);
  ok(!!(await until(async () => (await itemOf(badRun))?.state === "failed", 30000)), "a picture run whose job fails ends failed");
  ok(/couldn't make the pictures/.test((await itemOf(badRun)).data.error ?? "") && (await runOf(badRun)).status === "paused", "…with ComfyUI's message, and the run paused on the server");
  ok(comfy.calls.filter((x) => x.path === "/prompt").length - promptsBefore === 2, "…after the job was asked for again once");
  comfy.setMode({ fail: null });
} finally {
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  await comfy.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
