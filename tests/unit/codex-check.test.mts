import { codexCheckRequest, parseCodexCheck, selectEntries, MAX_SUGGESTIONS } from "../../src/lib/ai/codexCheckAi.ts";
import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

let n = 0;
const op = (entry_id: string, name: string, extra: Partial<CodexOp> = {}): CodexOp => ({
  id: `o${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, op: "create", name, type: "character", aliases: [], content: "", always_include: false, posted_at: n, ...extra,
});
const fact = (entry_id: string, fact_id: string, aspect: string, form: string, text: string): FactOp => ({
  id: `f${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, fact_id, op: "set", aspect, form, text, quote: "", posted_at: n,
});

const entries = foldCodex(
  [
    op("mira", "Mira", { aliases: ["the vixen"], content: "A young fox-girl." }),
    op("tomas", "Tomas"),
    op("hollow", "The Hollow", { type: "place" }),
    op("sage", "Old Sage", { always_include: true }),
  ],
  [
    fact("mira", "f-form", "form", "vixen", "change complete"),
    fact("mira", "f-ears", "Ears", "", "Tall russet fox ears."),
    fact("mira", "f-eyes", "Eyes", "vixen", "Amber eyes."),
    fact("mira", "f-sex", "Sex", "", "Female."),
    fact("tomas", "t-hair", "Hair", "", "Short black hair."),
  ],
);

const body = 'Mira shook out her tail. "I can smell the Hollow," she said. Her ears flicked, now tall and russet, and her eyes were gold. The grass was green.';

// ---- request ----
const req = codexCheckRequest(8000, { chapter: { title: "One", body }, entries, otherNames: ["Zed"] });
ok(req.message.includes("Mira [character] (also: the vixen)"), "request names the mentioned entry with its aliases");
ok(req.message.includes("Current form: vixen, change complete"), "request shows the current form and its note");
ok(req.message.includes("- Ears [every form]: Tall russet fox ears.") && req.message.includes("- Eyes [vixen form]: Amber eyes."), "request lists each fact with its aspect and form");
ok(req.message.includes("Notes: A young fox-girl."), "request shows the notes");
ok(req.message.includes("The Hollow [place]"), "request shows another mentioned entry");
ok(!req.message.includes("Short black hair") && !/^Tomas \[/m.test(req.message), "request leaves out an entry the chapter does not mention");
ok(/Old Sage \[character\]/.test(req.message), "request keeps an always-included entry");
ok(/Other names already in the codex \(not new\): Zed, Tomas/.test(req.message), "request lists the other names, the unmentioned entries among them");
ok(req.message.includes('Chapter to read: "One"') && req.message.includes("tail"), "request has the chapter");
ok(req.system!.includes("Reply with JSON only") && req.system!.includes("physical transformation") && req.system!.includes("Ears"), "system prompt: JSON only, transformation, starter aspects");
ok(selectEntries(entries, body).map((e) => e.name).join() === "Mira,The Hollow,Old Sage", "selectEntries: mentioned first, then always-included");
const longNotes = foldCodex([op("x", "Mira", { content: "n".repeat(900) })]);
ok(!codexCheckRequest(8000, { chapter: { title: "t", body }, entries: longNotes, otherNames: [] }).message.includes("n".repeat(400)), "notes are cut to 300 characters");
const fitted = codexCheckRequest(4000, { chapter: { title: "Long", body: "word ".repeat(30000) }, entries, otherNames: [] });
ok(fitted.message.length < 20000 && fitted.message.includes("…"), "a long chapter is cut to fit");

// ---- parse ----
const reply = (changes: unknown[]) => JSON.stringify({ changes });
const opts = { body, entries, otherNames: ["Zed"] };
const good = parseCodexCheck(
  reply([
    { kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen", text: "Gold eyes.", quote: "her eyes were gold" },
    { kind: "set", entry: "the vixen", aspect: "Tail", text: "Bushy russet tail.", quote: "Mira shook out her tail" },
    { kind: "form", entry: "Mira", form: "full vixen", text: "settled", quote: "Mira shook out her tail" },
    { kind: "retire", entry: "Mira", aspect: "Sex", quote: "Mira shook out her tail" },
    { kind: "conflict", entry: "mira", aspect: "ears", text: "Short round ears.", quote: "Her ears flicked" },
    { kind: "entry", name: "Brindle", type: "character", aliases: ["Brin"], notes: "A fox.", facts: [{ aspect: "Fur", form: "", text: "Grey." }], quote: "The grass was green" },
  ]),
  opts,
);
ok(good.length === 6, "good items are kept: " + good.length);
ok(good[0].kind === "set" && good[0].entry_id === "mira" && good[0].aspect === "Eyes" && good[0].form === "vixen" && good[0].after === "Gold eyes.", "a set keeps the entry id, aspect, form and text");
ok(good[1].entry_id === "mira" && good[1].aspect === "Tail", "an entry is matched by alias");
ok(good[2].kind === "form" && good[2].form === "full vixen" && good[2].after === "settled", "a form item keeps the form name and the note");
ok(good[3].kind === "retire" && good[3].aspect === "Sex" && good[3].after === "", "a retire of a live fact is kept");
ok(good[4].kind === "conflict" && good[4].aspect === "Ears", "a conflict is kept, with the entry's own spelling of the aspect");
ok(good[5].kind === "entry" && good[5].entry_id === undefined && good[5].entry?.name === "Brindle" && good[5].entry.facts.length === 1 && good[5].entry.aliases[0] === "Brin", "a new entry carries its proposal");

const dropped = parseCodexCheck(
  reply([
    { kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen", text: "Gold eyes.", quote: "words that are not in the chapter" },
    { kind: "set", entry: "Nobody", aspect: "Eyes", text: "Blue.", quote: "her eyes were gold" },
    { kind: "set", entry: "Mira", aspect: "Ears", text: "tall russet fox ears.", quote: "Her ears flicked" },
    { kind: "retire", entry: "Mira", aspect: "Wings", quote: "Her ears flicked" },
    { kind: "form", entry: "Mira", form: "", text: "x", quote: "Her ears flicked" },
    { kind: "entry", name: "Zed", type: "character", quote: "The grass was green" },
    { kind: "entry", name: "Tomas", type: "character", quote: "The grass was green" },
    { kind: "entry", name: "the vixen", type: "character", quote: "The grass was green" },
    { kind: "bogus", entry: "Mira", aspect: "Eyes", text: "x", quote: "Her ears flicked" },
    { kind: "set", entry: "Mira", aspect: "Eyes", text: "", quote: "Her ears flicked" },
    { kind: "entry", name: "Newcomer", quote: "The grass was green" },
    { kind: "entry", name: "newcomer", quote: "The grass was green" },
  ]),
  opts,
);
ok(dropped.length === 1 && dropped[0].entry?.name === "Newcomer", "bad quotes, unknown entries, unchanged sets, missing facts, empty forms, existing or duplicate new entries and unknown kinds are dropped: " + JSON.stringify(dropped.map((d) => d.kind)));

const many = Array.from({ length: 30 }, (_, i) => ({ kind: "set", entry: "Mira", aspect: `Aspect ${i}`, text: `Text ${i}`, quote: "Her ears flicked" }));
ok(parseCodexCheck(reply(many), opts).length === MAX_SUGGESTIONS && MAX_SUGGESTIONS === 12, "at most 12 items");

const fenced = parseCodexCheck('Here you go:\n```json\n{"changes":[{"kind":"set","entry":"Mira","aspect":"Voice","text":"Low and calm.","quote":"I can smell the Hollow"}]}\n```', opts);
ok(fenced.length === 1 && fenced[0].aspect === "Voice", "fenced JSON is read");
ok(parseCodexCheck('{"changes":[]}', opts).length === 0, "an empty reply gives nothing");
let threw = false;
try { parseCodexCheck("no json here", opts); } catch { threw = true; }
ok(threw, "a reply with no JSON throws, so the task is retried");
const curly = parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Voice", text: "Calm.", quote: "“I can smell the Hollow,” she said" }]), opts);
ok(curly.length === 1, "a quote with different quote marks still matches");
ok(parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "form", form: "kit", text: "young", quote: "Her ears flicked" }]), opts)[0]?.kind === "form", "a set of the aspect 'form' becomes a form item");
