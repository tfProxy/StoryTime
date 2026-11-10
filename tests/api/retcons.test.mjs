// Retcons: POST /api/stories/<id>/retcons changes a codex fact (or takes a change in words), and a review run (check
// "retcon") has the (fake) AI read the chapters below for passages that no longer fit. Its proposals wait in
// GET /api/stories/<id>/retcons until accepted (/api/retcon-changes/<id>/apply) or skipped; Undo puts it all back.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";

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

// The fake AI changes "gray" to "blue" in each sentence that has it, copying the passage with straight quotes.
const ai = await startFakeAi({
  port: 3581,
  delay: 5,
  reply: (body) => {
    const msg = body.messages.at(-1).content;
    const chapter = msg.split(/\n\n/).find((p) => p.startsWith("Chapter:")) ?? "";
    const sentences = chapter.split("\n").slice(1).join(" ").match(/[^.!?]+[.!?]+["”]?/g) ?? [];
    const edits = sentences
      .map((s) => s.trim())
      .filter((s) => /gray/i.test(s))
      .map((s) => ({ old: s.replace(/[“”]/g, '"'), new: s.replace(/gray/g, "blue") }));
    return JSON.stringify({ edits, note: chapter.includes("Tavern") ? "The tavern sign may need a look." : "" });
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const runs = [];
const chapter = async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
  });

  // Root -> A -> B -> C (Mira's eyes change in the story at C) -> D, and Root -> Side (doesn't name her).
  const s = await call("POST", "/api/stories", { title: "Retcon", premise: "p", chapter: { title: "Root", body: "Mira had gray eyes.", choices: ["Go", "Side"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const add = async (parent, title, body, i = 0, choices = ["Go"]) => {
    const choice = (await call("GET", `/api/chapters/${parent}`)).json.choices[i];
    return (await call("POST", "/api/chapters", { choice_id: choice.id, title, body, choices })).json.chapter_id;
  };
  const a = await add(root, "A", "“Your eyes are gray,” Oda told Mira. Mira smiled.");
  const side = await add(root, "Side", "Oda walked alone past the gray wall.", 1, []);
  const b = await add(a, "B", "Mira's gray eyes narrowed at the Tavern.");
  const c = await add(b, "C", "Magic turned Mira's eyes gold.");
  const d = await add(c, "D", "Mira blinked her gray eyes.", 0, []);
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  const eyes = (await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: mira, op: "set", aspect: "Eyes", text: "Gray." })).json.fact_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: c, entry_id: mira, op: "set", aspect: "Eyes", text: "Gold.", fact_id: eyes });

  const finish = async (run) => {
    runs.push(run);
    const done = await until(async () => (await call("GET", "/api/queue")).json.items.find((i) => i.key === `run:${run}`)?.state === "done");
    await call("DELETE", `/api/queue/items/run:${run}`);
    return done;
  };
  const list = async () => (await call("GET", `/api/stories/${story}/retcons`)).json.retcons;
  const eyesAt = async (ch) => (await call("GET", `/api/chapters/${ch}/codex`)).json.entries.find((e) => e.entry_id === mira).facts.find((f) => f.fact_id === eyes)?.text;

  // ---- preview: where it starts, what it reads, where it stops ----
  const codexBody = { kind: "codex", chapter_id: b, entry_id: mira, fact_id: eyes, text: "Blue.", from: "set" };
  let r = await call("POST", `/api/stories/${story}/retcons/preview`, codexBody);
  ok(r.status === 200 && r.json.start.id === root && r.json.canSet === true && r.json.before === "Gray.", "from where it was set: starts at Root: " + JSON.stringify(r.json?.start));
  ok(r.json.chapters.map((x) => x.title).join() === "Root,A,B", "reads the chapters that name Mira, stopping before C: " + JSON.stringify(r.json.chapters.map((x) => x.title)));
  ok(r.json.stops.map((x) => x.title).join() === "C" && r.json.skipped === 1, "C is a stop and Side is left out by the name filter");
  r = await call("POST", `/api/stories/${story}/retcons/preview`, { ...codexBody, from: "here", all: true });
  ok(r.json.start.id === b && r.json.chapters.map((x) => x.title).join() === "B", "from this chapter on: starts at B");
  ok((await call("POST", `/api/stories/${story}/retcons/preview`, { ...codexBody, fact_id: "nope" })).status === 404, "an unknown fact is refused");
  ok((await call("POST", `/api/stories/${story}/retcons`, { ...codexBody, text: "Gray." })).status === 400, "the same text is refused");

  // ---- a codex retcon from where it was set ----
  r = await call("POST", `/api/stories/${story}/retcons`, codexBody);
  ok(r.status === 201 && r.json.reads === 3 && !!r.json.run_id, "started, reading 3 chapters: " + JSON.stringify(r.json));
  const retconId = r.json.id;
  ok((await eyesAt(b)) === "Blue." && (await eyesAt(root)) === "Blue." && (await eyesAt(d)) === "Gold.", "the fact is changed where it was set; C's own version stays");
  ok(!!(await finish(r.json.run_id)), "the worker takes the run to the end");
  const run = (await call("GET", `/api/ai-runs/${r.json.run_id}`)).json;
  ok(run.tasks.length === 3 && run.tasks.every((t) => t.kind === "retcon" && t.status === "done" && t.found === 1), "each chapter had one passage to change: " + JSON.stringify(run.tasks.map((t) => [t.label, t.status, t.found])));
  let [retcon] = await list();
  ok(retcon.id === retconId && retcon.title === "Mira: Eyes" && retcon.instruction.includes("Now: Blue.") && retcon.instruction.includes("Before: Gray."), "listed, with the change in words");
  ok(retcon.changes.map((x) => x.chapter_id).join() === [root, a, b].join() && retcon.changes.every((x) => x.status === "open"), "proposals for Root, A and B, in story order");
  const byChapter = (id) => retcon.changes.find((x) => x.chapter_id === id);
  ok(byChapter(a).edits[0].old === "“Your eyes are gray,” Oda told Mira.", "a passage copied with straight quotes is kept in the chapter's spelling");
  ok(byChapter(b).note === "The tavern sign may need a look.", "the AI's note is kept");
  ok((await chapter(a)).body.includes("gray"), "nothing in a chapter changes before it is accepted");

  // Accept A with a reworded replacement; skip Root.
  r = await call("POST", `/api/retcon-changes/${byChapter(a).id}/apply`, { edits: [{ old: byChapter(a).edits[0].old, new: "“Your eyes are sky blue,” Oda told Mira." }] });
  ok(r.status === 200 && r.json.revision === 2, "A is changed: " + JSON.stringify(r.json));
  const chA = await chapter(a);
  ok(chA.body === "“Your eyes are sky blue,” Oda told Mira. Mira smiled." && chA.edit_note === "Retcon: Mira: Eyes", "with the owner's wording, and a revision note");
  ok((await call("POST", `/api/retcon-changes/${byChapter(a).id}/apply`, {})).status === 409, "a decided change can't be applied again");
  ok((await call("POST", `/api/retcon-changes/${byChapter(root).id}/skip`)).status === 200 && (await chapter(root)).body === "Mira had gray eyes.", "Root is skipped and keeps its text");

  // B is edited meanwhile so the passage is gone: Accept all can't change it.
  const chB = await chapter(b);
  await call("PATCH", `/api/chapters/${b}`, { base_revision: chB.revision, title: "B", body: "Mira squinted at the Tavern." });
  r = await call("POST", `/api/retcons/${retconId}/apply-all`);
  ok(r.status === 200 && r.json.applied === 0 && r.json.failed.join() === "B", "Accept all reports B as edited since: " + JSON.stringify(r.json));
  [retcon] = await list();
  ok(retcon.changes.find((x) => x.chapter_id === b).edited_since === true, "…and B shows as edited since the AI read it");

  // ---- undo ----
  r = await call("POST", `/api/retcons/${retconId}/undo`);
  ok(r.status === 200 && r.json.restored === 1 && r.json.kept.length === 0, "undo puts back A: " + JSON.stringify(r.json));
  ok((await chapter(a)).body.startsWith("“Your eyes are gray,”") && (await eyesAt(b)) === "Gray.", "A's text and the codex fact are back");
  [retcon] = await list();
  ok(retcon.undone_at !== null && retcon.changes.every((x) => x.status !== "open"), "the retcon is undone and nothing is left open");
  ok((await call("POST", `/api/retcons/${retconId}/undo`)).status === 409, "it can't be undone twice");

  // ---- from this chapter on: a new version of the fact; undo removes it ----
  r = await call("POST", `/api/stories/${story}/retcons`, { ...codexBody, chapter_id: b, from: "here", all: true });
  ok(r.status === 201 && r.json.reads === 1, "from B on: reads B");
  ok((await eyesAt(a)) === "Gray." && (await eyesAt(b)) === "Blue.", "A keeps the old version, B has the new one");
  await finish(r.json.run_id);
  await call("POST", `/api/retcons/${r.json.id}/undo`);
  ok((await eyesAt(b)) === "Gray.", "undo removes the new version");

  // ---- a retcon in words, only chapters that mention a word ----
  r = await call("POST", `/api/stories/${story}/retcons/preview`, { kind: "note", chapter_id: root, instruction: "The wall is blue.", only: "wall" });
  ok(r.json.chapters.map((x) => x.title).join() === "Side" && r.json.skipped === 5,"the word filter picks Side: " + JSON.stringify(r.json.chapters));
  r = await call("POST", `/api/stories/${story}/retcons`, { kind: "note", chapter_id: root, instruction: "The wall is blue.", only: "wall" });
  ok(r.status === 201 && r.json.reads === 1, "a retcon in words starts");
  await finish(r.json.run_id);
  const words = (await list()).find((x) => x.id === r.json.id);
  ok(words.kind === "note" && words.changes.length === 1 && words.changes[0].edits[0].new === "Oda walked alone past the blue wall.", "its proposal for Side");
  ok((await call("POST", `/api/retcons/${r.json.id}/apply-all`)).json.applied === 1 && (await chapter(side)).body === "Oda walked alone past the blue wall.", "Accept all changes Side");
  void d;
} finally {
  for (const id of runs) await call("DELETE", `/api/ai-runs/${id}/queue?end=1`);
  await call("PUT", "/api/queue/paused", { paused: false });
  await ai.close();
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else {
    await call("PUT", "/api/settings", settingsBefore);
  }
}
