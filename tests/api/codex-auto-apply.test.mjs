// "Apply the AI's codex changes automatically" (autoApplyCodex): a full reading of a chapter applies its fact and form
// changes at once, marked as the AI's (ai_suggestion_id) until approved; new entries, removals and contradictions wait.
// A new reading of the chapter replaces the unapproved AI facts, but leaves the owner's (approved or edited) alone.
import Database from "better-sqlite3";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
const setApply = (on) =>
  // No AI is set up, so saving chapters queues no automatic codex check: the readings below are posted by hand.
  call("PUT", "/api/settings", { ...(settingsBefore ?? {}), connections: [], defaults: { main: null, cheap: null }, autoReview: false, autoCodex: true, autoApplyCodex: on });
try {
  ok((await setApply(true)).json.settings.autoApplyCodex === true, "autoApplyCodex can be turned on");

  const s = await call("POST", "/api/stories", { title: "Auto codex", premise: "P", chapter: { title: "Root", body: "Mira stood in the Hollow.", summary: "s", choices: ["Go"] } });
  const story = s.json.story_id;
  const root = s.json.chapter_id;
  const body1 = 'Mira gasped. "My ears are tall and russet now," she said. Her tail was gone. Brindle the old fox watched. "Her hair is red," said Tomas.';
  const goId = (await call("GET", `/api/chapters/${root}`)).json.choices[0].id;
  const c1 = (await call("POST", "/api/chapters", { choice_id: goId, title: "Change", body: body1, summary: "s", choices: ["On"] })).json.chapter_id;
  const onId = (await call("GET", `/api/chapters/${c1}`)).json.choices[0].id;
  const c2 = (await call("POST", "/api/chapters", { choice_id: onId, title: "Later", body: "Mira walked on.", summary: "s" })).json.chapter_id;
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character" })).json.entry_id;
  const setFact = (anchor, aspect, text, extra = {}) => call("POST", "/api/codex/facts", { anchor_chapter_id: anchor, entry_id: mira, op: "set", aspect, form: "", text, ...extra });
  await setFact(root, "Ears", "Human ears.");
  await setFact(root, "Hair", "Black hair.");
  await setFact(root, "Tail", "A small bare tail.");
  await setFact(root, "form", "", { form: "human" });
  const miraAt = async (chapter) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.name === "Mira");
  const factsOf = async (chapter, aspect) => (await miraAt(chapter)).facts.filter((f) => f.aspect === aspect);
  const factOf = async (chapter, aspect) => (await factsOf(chapter, aspect))[0];
  const read = (list) => call("POST", `/api/chapters/${c1}/codex-suggestions`, { revision: 1, suggestions: list });
  const counts = async () => (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.counts;
  const q = "Mira gasped";

  // ---- the first reading ----
  let r = await read([
    { kind: "set", entry_id: mira, aspect: "Ears", after: "Tall russet fox ears.", quote: "My ears are tall and russet now" },
    { kind: "set", entry_id: mira, aspect: "Eyes", after: "Amber eyes.", quote: q },
    { kind: "form", entry_id: mira, form: "vixen", after: "change begun", quote: q },
    { kind: "retire", entry_id: mira, aspect: "Tail", quote: "Her tail was gone" },
    { kind: "entry", entry: { name: "Brindle", type: "character", facts: [{ aspect: "Age", text: "Old." }] }, quote: "Brindle the old fox watched" },
    { kind: "conflict", entry_id: mira, aspect: "Hair", after: "Red hair.", quote: "Her hair is red" },
  ]);
  ok(r.status === 200 && r.json.saved === 6 && r.json.applied === 3, "fact and form changes are applied: " + JSON.stringify(r.json));
  let ears = await factOf(c1, "Ears");
  ok(ears.text === "Tall russet fox ears." && !!ears.op.ai_suggestion_id && ears.op.anchor_chapter_id === c1, "the changed fact is the AI's, at the chapter");
  ok(ears.quote === "My ears are tall and russet now", "…with the quote");
  ok(!!(await factOf(c1, "Eyes")).op.ai_suggestion_id, "a new fact is the AI's");
  const m1 = await miraAt(c1);
  ok(m1.form?.name === "vixen" && !!m1.form.fact.op.ai_suggestion_id, "the form change is the AI's");
  ok((await factOf(root, "Ears")).text === "Human ears." && !(await factOf(root, "Ears")).op.ai_suggestion_id, "the earlier chapter keeps the owner's fact");
  ok((await factOf(c1, "Tail"))?.text === "A small bare tail." && (await factOf(c1, "Hair")).text === "Black hair.", "a removal and a contradiction are not applied");
  let c = await counts();
  ok(c.byChapter[c1] === 3 && c.aiByChapter[c1] === 3, "three wait in the inbox, three AI facts wait for approval: " + JSON.stringify(c));
  const open = (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.suggestions.map((x) => x.kind).sort();
  ok(JSON.stringify(open) === JSON.stringify(["conflict", "entry", "retire"]), "the open ones are the removal, the new entry and the contradiction");

  // ---- a new reading replaces the unapproved AI facts ----
  r = await read([{ kind: "set", entry_id: mira, aspect: "Ears", after: "Long fox ears.", quote: q }]);
  ok(r.json.applied === 1, "the new reading is applied");
  ok((await factOf(c1, "Ears")).text === "Long fox ears." && (await factsOf(c1, "Ears")).length === 1, "it replaces the AI's earlier Ears");
  ok((await factOf(c1, "Eyes")) === undefined, "the AI's earlier new fact is gone");
  ok((await miraAt(c1)).form?.name === "human", "…and so is its form change");
  ok((await counts()).aiByChapter[c1] === 1, "one AI fact waits now");

  // ---- approving ----
  ears = await factOf(c1, "Ears");
  ok((await call("POST", "/api/codex/approve", { ids: [] })).status === 400, "approve needs ids");
  r = await call("POST", "/api/codex/approve", { ids: [ears.op.id] });
  ok(r.status === 200 && r.json.approved === 1, "an AI fact is approved");
  ok(!(await factOf(c1, "Ears")).op.ai_suggestion_id && (await counts()).aiByChapter[c1] === undefined, "…and isn't the AI's any more");
  r = await read([{ kind: "set", entry_id: mira, aspect: "Ears", after: "Huge ears.", quote: q }]);
  ok(r.json.saved === 1 && r.json.applied === 0 && (await factOf(c1, "Ears")).text === "Long fox ears.", "a new reading leaves an approved fact alone; the change waits in the inbox");

  // ---- the owner's edit of an AI fact at its chapter ----
  r = await read([{ kind: "set", entry_id: mira, aspect: "Eyes", after: "Amber eyes.", quote: q }]);
  const eyes = await factOf(c1, "Eyes");
  ok(r.json.applied === 1 && !!eyes.op.ai_suggestion_id, "the AI adds Eyes");
  await setFact(c1, "Eyes", "Green eyes.", { fact_id: eyes.fact_id });
  ok(!(await factOf(c1, "Eyes")).op.ai_suggestion_id && (await counts()).aiByChapter[c1] === undefined, "the owner's edit is theirs");
  r = await read([{ kind: "set", entry_id: mira, aspect: "Eyes", after: "Gold eyes.", quote: q }]);
  ok(r.json.applied === 0 && (await factOf(c1, "Eyes")).text === "Green eyes." && (await factsOf(c1, "Eyes")).length === 1, "a new reading leaves the owner's edit alone");

  // ---- a later chapter changes an AI fact: the new reading carries on the same fact ----
  r = await read([{ kind: "set", entry_id: mira, aspect: "Scent", after: "Smells of pine.", quote: q }]);
  const scent = await factOf(c1, "Scent");
  await setFact(c2, "Scent", "Smells of smoke.", { fact_id: scent.fact_id });
  r = await read([{ kind: "set", entry_id: mira, aspect: "Scent", after: "Smells musky.", quote: q }]);
  ok(r.json.applied === 1 && (await factOf(c1, "Scent")).text === "Smells musky." && (await factOf(c1, "Scent")).fact_id === scent.fact_id, "the new reading keeps the fact's id");
  ok((await factsOf(c2, "Scent")).length === 1 && (await factOf(c2, "Scent")).text === "Smells of smoke.", "the later chapter has one Scent, its own");

  // ---- turned off: suggestions only ----
  await setApply(false);
  r = await read([{ kind: "set", entry_id: mira, aspect: "Fur", after: "Russet fur.", quote: q }]);
  ok(r.json.saved === 1 && r.json.applied === 0 && (await factOf(c1, "Fur")) === undefined, "with the setting off, nothing is applied");
  ok((await factOf(c1, "Scent")).text === "Smells musky.", "…and the AI's earlier facts stay");

  // ---- export and import keep the mark ----
  const exported = (await call("GET", `/api/stories/${story}/export?format=json`)).json;
  ok(exported?.codex_facts?.some((f) => f.ai_suggestion_id), "the export carries the AI mark");

  // ---- undoing an AI fact: the fact goes, the suggestion behind it is dismissed ----
  await setApply(true);
  r = await read([{ kind: "set", entry_id: mira, aspect: "Voice", after: "A low rasp.", quote: q }]);
  const voice = await factOf(c1, "Voice");
  ok(r.json.applied === 1 && !!voice.op.ai_suggestion_id, "the AI adds Voice");
  ok((await call("POST", "/api/codex/undo-ai", { ids: [] })).status === 400, "undo needs ids");
  const ownEars = await factOf(c1, "Ears");
  ok(!ownEars.op.ai_suggestion_id, "(Ears was approved earlier, so it is the owner's)");
  r = await call("POST", "/api/codex/undo-ai", { ids: [ownEars.op.id] });
  ok(r.status === 200 && r.json.undone === 0 && !!(await factOf(c1, "Ears")), "undo leaves a fact the owner has approved alone");
  r = await call("POST", "/api/codex/undo-ai", { ids: [voice.op.id] });
  ok(r.status === 200 && r.json.undone === 1, "an AI fact is undone");
  ok((await factOf(c1, "Voice")) === undefined, "…and the fact is gone from the codex");
  const dismissed = (await call("GET", `/api/stories/${story}/codex-suggestions?status=dismissed`)).json.suggestions;
  ok(dismissed.some((x) => x.aspect === "Voice" && x.after === "A low rasp."), "…and its suggestion is dismissed");
  r = await call("POST", "/api/codex/undo-ai", { ids: [voice.op.id] });
  ok(r.status === 200 && r.json.undone === 0, "undoing it again does nothing");
  r = await read([{ kind: "set", entry_id: mira, aspect: "Voice", after: "A low rasp.", quote: q }]);
  ok(r.json.applied === 0 && (await factOf(c1, "Voice")) === undefined, "a new reading doesn't apply what was undone");
} finally {
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
