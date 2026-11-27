import { codexCheckRequest, describeForCheck, parseCodexCheck, selectEntries, MAX_SUGGESTIONS } from "../../src/lib/ai/codexCheckAi.ts";
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
ok(!req.message.includes("A young fox-girl") && !req.message.includes("Notes:"), "request never shows an entry's old notes");
ok(req.message.includes("The Hollow [place]"), "request shows another mentioned entry");
ok(!req.message.includes("Short black hair") && !/^Tomas \[/m.test(req.message), "request leaves out an entry the chapter does not mention");
ok(/Old Sage \[character\]/.test(req.message), "request keeps an always-included entry");
ok(/Other names already in the codex \(not new\): Zed, Tomas/.test(req.message), "request lists the other names, the unmentioned entries among them");
ok(req.message.includes('Chapter to read: "One"') && req.message.includes("tail"), "request has the chapter");
ok(req.system!.includes("Reply with JSON only") && req.system!.includes("physical transformation") && req.system!.includes("Ears"), "system prompt: JSON only, transformation, starter aspects");
ok(selectEntries(entries, body).map((e) => e.name).join() === "Mira,The Hollow,Old Sage", "selectEntries: mentioned first, then always-included");

// Many forms: only every-form facts, the current form's and the forms the chapter names are shown in full.
const shifter = foldCodex(
  [op("syl", "Sylvia")],
  [
    fact("syl", "s-form", "form", "husky", ""),
    fact("syl", "s-pers", "Personality", "", "Blunt."),
    fact("syl", "s-hair-h", "Hair", "human", "Blonde."),
    fact("syl", "s-skin-l", "Skin", "lizard", "Green scales."),
    fact("syl", "s-skin-k", "Skin", "husky", "Black latex."),
  ],
);
const quiet = describeForCheck(shifter[0], "Sylvia wagged her tail.");
ok(quiet.includes("Personality [every form]: Blunt.") && quiet.includes("Skin [husky form]: Black latex."), "many forms: every-form facts and the current form's are shown");
ok(!quiet.includes("Green scales") && !quiet.includes("Blonde") && quiet.includes("Other forms (their facts are not shown): human, lizard"), "…other forms are named, without their facts: " + quiet);
ok(describeForCheck(shifter[0], "Sylvia felt the lizard rising again.").includes("Skin [lizard form]: Green scales."), "…a form the chapter names is shown in full");

// "Update from the story": one entry in focus
const mira = entries.find((e) => e.entry_id === "mira")!;
const focused = codexCheckRequest(8000, { chapter: { title: "One", body }, entries, otherNames: [], focus: mira });
ok(focused.message.includes("The codex now, for Mira:") && focused.message.includes("- Ears [every form]: Tall russet fox ears."), "focused: shows the entry and its facts");
ok(!/^The Hollow \[/m.test(focused.message) && !/^Old Sage \[/m.test(focused.message), "…and no other entry, mentioned or always included");
ok(focused.message.includes("Propose only the changes this chapter makes to Mira") && focused.message.includes("propose no new entries"), "…asks for that entry's changes alone");
const longNotes = foldCodex([op("x", "Mira", { content: "n".repeat(900) })]);
ok(!codexCheckRequest(8000, { chapter: { title: "t", body }, entries: longNotes, otherNames: [] }).message.includes("n".repeat(400)), "notes are cut to 300 characters");
const fitted = codexCheckRequest(4000, { chapter: { title: "Long", body: "word ".repeat(30000) }, entries, otherNames: [] });
ok(fitted.message.length < 20000 && fitted.message.includes("…"), "a long chapter is cut to fit");
const ending = "word ".repeat(30000) + "THE LAST LINE.";
ok(codexCheckRequest(4000, { chapter: { title: "Long", body: ending }, entries, otherNames: [] }).message.includes("THE LAST LINE."), "…keeping its end, where the state the codex records is");
// A 9,000-character chapter (about 2,200 tokens) fits whole in an 8,000-token context.
const nineK = "A sentence of prose that runs on. ".repeat(270) + "THE END.";
ok(!codexCheckRequest(8000, { chapter: { title: "Mid", body: nineK }, entries, otherNames: [] }).message.includes("[…]"), "a 9,000-character chapter is not cut at 8,000 tokens");

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
    { kind: "set", entry: "Zed", aspect: "Eyes", text: "Blue.", quote: "her eyes were gold" },
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
// Over the limit, in the chapter's order: the form change and the chapter's end are kept, not just the first twelve.
const early = Array.from({ length: 12 }, (_, i) => ({ kind: "set", entry: "Mira", aspect: `Early ${i}`, text: `Text ${i}`, quote: "Mira shook out her tail" }));
const longReply = [...early, { kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen", text: "Gold eyes.", quote: "her eyes were gold" }, { kind: "form", entry: "Mira", form: "moon fox", text: "", quote: "Her ears flicked" }];
const trimmed = parseCodexCheck(reply(longReply), opts);
ok(trimmed.length === 12 && trimmed.some((s) => s.kind === "form") && trimmed.some((s) => s.aspect === "Eyes"), "over 12: the form change and the latest change are kept: " + trimmed.map((s) => s.aspect || s.kind).join(","));
ok(trimmed.findIndex((s) => s.aspect === "Eyes") < trimmed.findIndex((s) => s.kind === "form"), "…in the reply's order");
const strayReply = (extra: unknown[] = []) => reply([
  ...extra,
  { kind: "set", entry: "Brindle", aspect: "Species", form: "", text: "Fox.", quote: "The grass was green" },
  { kind: "set", entry: "Brindle", aspect: "Eyes", form: "", text: "Grey eyes.", quote: "her eyes were gold" },
  { kind: "form", entry: "Brindle", form: "old fox", text: "", quote: "Her ears flicked" },
]);
const stray = parseCodexCheck(strayReply(), opts);
ok(stray.length === 1 && stray[0].kind === "entry" && stray[0].entry?.name === "Brindle" && stray[0].entry.facts.map((f) => f.aspect).join() === "Species,Eyes" && stray[0].quote === "The grass was green", "changes for a name the codex doesn't have become a proposal of that entry with their facts: " + JSON.stringify(stray));
const joinedStray = parseCodexCheck(strayReply([{ kind: "entry", name: "Brindle", type: "character", facts: [{ aspect: "Age", text: "Old." }], quote: "Mira shook out her tail" }]), opts);
ok(joinedStray.length === 1 && joinedStray[0].entry?.facts.map((f) => f.aspect).join() === "Age,Species,Eyes", "…or join the reply's own proposal of it");
ok(parseCodexCheck(reply([{ kind: "set", entry: "Zed", aspect: "Eyes", text: "Blue.", quote: "her eyes were gold" }]), opts).length === 0, "…but not for a name the codex lists (a misspelling or an entry left out of the request)");
const twice = parseCodexCheck(reply([
  { kind: "set", entry: "Mira", aspect: "Voice", text: "Calm.", quote: "I can smell the Hollow" },
  { kind: "set", entry: "Mira", aspect: "Voice", text: "Hoarse.", quote: "The grass was green" },
]), opts);
ok(twice.length === 1 && twice[0].after === "Hoarse.", "two changes to one fact: the one quoted later in the chapter wins");

const fenced = parseCodexCheck('Here you go:\n```json\n{"changes":[{"kind":"set","entry":"Mira","aspect":"Voice","text":"Low and calm.","quote":"I can smell the Hollow"}]}\n```', opts);
ok(fenced.length === 1 && fenced[0].aspect === "Voice", "fenced JSON is read");
ok(parseCodexCheck('{"changes":[]}', opts).length === 0, "an empty reply gives nothing");
let threw = false;
try { parseCodexCheck("no json here", opts); } catch { threw = true; }
ok(threw, "a reply with no JSON throws, so the task is retried");
const curly = parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Voice", text: "Calm.", quote: "“I can smell the Hollow,” she said" }]), opts);
ok(curly.length === 1, "a quote with different quote marks still matches");
const joined = parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Voice", text: "Calm.", quote: "I can smell the Hollow... Her ears flicked" }]), opts);
ok(joined[0]?.quote === 'I can smell the Hollow," she said. Her ears flicked',"a quote of pieces joined with ... is kept, as the chapter's own words: " + joined[0]?.quote);
const unquoted = parseCodexCheck(reply([{ kind: "entry", name: "Grass", type: "item", facts: [{ aspect: "Appearance", text: "Green." }] }]), opts);
ok(unquoted[0]?.quote === "The grass was green.", "a new entry without a quote is quoted where the chapter names it: " + unquoted[0]?.quote);
ok(parseCodexCheck(reply([{ kind: "entry", name: "Grasshopper", type: "item", facts: [{ aspect: "Appearance", text: "Green." }] }]), opts).length === 0, "…but not when the chapter never names it");
ok(parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Voice", form: "every form", text: "Calm.", quote: "I can smell the Hollow" }]), opts)[0]?.form === "", "a form of 'every form' becomes no form");
ok(parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen form", text: "Gold eyes.", quote: "her eyes were gold" }]), opts)[0]?.form === "vixen", "a form of 'vixen form' becomes 'vixen'");
const moved = parseCodexCheck(reply([
  { kind: "set", entry: "Mira", aspect: "Eyes", form: "current", text: "Silver eyes.", quote: "her eyes were gold" },
  { kind: "form", entry: "Mira", form: "moon fox", text: "", quote: "Mira shook out her tail" },
]), opts);
ok(moved.find((s) => s.kind === "set")?.form === "moon fox", "a fact for the 'current' form goes to the form the reply moves the entry to: " + JSON.stringify(moved));
const stays = parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Eyes", form: "current form", text: "Silver eyes.", quote: "her eyes were gold" }]), opts);
ok(stays[0]?.form === "vixen", "…or, when it moves nowhere, to the form the entry is in");
const staged = parseCodexCheck(reply([
  { kind: "form", entry: "Mira", form: "vixen, fully changed", text: "", quote: "Mira shook out her tail" },
  { kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen, fully changed", text: "Silver eyes.", quote: "her eyes were gold" },
]), opts);
ok(staged[0]?.form === "vixen" && staged[0].after === "fully changed" && staged[1]?.form === "vixen", "a form given as 'vixen, fully changed' (as the request shows it) is the form vixen at that stage: " + JSON.stringify(staged));
const unnamed = parseCodexCheck(reply([
  { kind: "set", entry: "Mira", aspect: "Eyes", form: "current", text: "Silver eyes.", quote: "her eyes were gold" },
  { kind: "set", entry: "Mira", aspect: "Personality", form: "current", text: "Fierce.", quote: "Her ears flicked" },
  { kind: "form", entry: "Mira", form: "true form", text: "", quote: "Mira shook out her tail" },
]), opts);
ok(unnamed.length === 1 && unnamed[0].aspect === "Personality" && unnamed[0].form === "", "a move to a form the reply doesn't name drops its 'current' facts, not filing them under the old form (a fact for every form stays): " + JSON.stringify(unnamed));
ok(parseCodexCheck(reply([{ kind: "form", entry: "Mira", form: "true", text: "", quote: "Mira shook out her tail" }]), opts).length === 0, "a form item named 'true' names nothing and is dropped");
const labelled = parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "Eyes [vixen form]", text: "Gold eyes.", quote: "her eyes were gold" }]), opts)[0];
ok(labelled?.aspect === "Eyes" && labelled.form === "vixen", "an aspect copied with its '[vixen form]' label is 'Eyes' in the form 'vixen': " + JSON.stringify(labelled));
ok(parseCodexCheck(reply([{ kind: "set", entry: "Mira", aspect: "form", form: "kit", text: "young", quote: "Her ears flicked" }]), opts)[0]?.kind === "form", "a set of the aspect 'form' becomes a form item");

// ---- facts that say nothing ----
{
  const empty = parseCodexCheck(
    reply([
      { kind: "set", entry: "Mira", aspect: "Build", text: "Unknown height and build - body feels entirely alien", quote: "Her ears flicked" },
      { kind: "set", entry: "Mira", aspect: "Skin", text: "Not described in this chapter.", quote: "Her ears flicked" },
      { kind: "set", entry: "Mira", aspect: "Voice", text: "Unclear", quote: "Her ears flicked" },
      { kind: "set", entry: "Mira", aspect: "Eyes", form: "vixen", text: "Gold eyes of unknown origin.", quote: "her eyes were gold" },
      { kind: "entry", name: "Newcomer", facts: [{ aspect: "Hair", text: "Unknown" }, { aspect: "Eyes", text: "Green eyes." }], quote: "The grass was green" },
    ]),
    opts,
  );
  ok(empty.length === 2 && empty[0].aspect === "Eyes", "a fact that only says the detail is unknown or not described is dropped; one that merely uses the word is kept: " + JSON.stringify(empty.map((e) => e.aspect)));
  ok(empty[1]?.entry?.facts.length === 1 && empty[1].entry.facts[0].aspect === "Eyes", "…in a new entry's facts too");
}

// ---- the wording rules are in the request ----
ok(/not how it changed/.test(req.system) && /"unknown"/.test(req.system), "the request tells the AI to say how things are, not how they changed, and never to write 'unknown'");
