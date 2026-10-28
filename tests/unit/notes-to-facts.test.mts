import { notesToFactsRequest, parseNotesToFacts, MAX_NOTE_FACTS } from "../../src/lib/ai/notesToFactsAi.ts";
import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

let n = 0;
const op = (entry_id: string, name: string, extra: Partial<CodexOp> = {}): CodexOp => ({
  id: `o${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, op: "create", name, type: "character", aliases: [], content: "", always_include: false, posted_at: n, ...extra,
});
const fact = (entry_id: string, fact_id: string, aspect: string, form: string, text: string): FactOp => ({
  id: `f${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, fact_id, op: "set", aspect, form, text, quote: "", posted_at: n,
});

const notes = "Mira is a young fox-girl with tall russet ears and amber eyes. She is shy around strangers. Currently half-changed.";
const [mira] = foldCodex(
  [op("mira", "Mira", { aliases: ["the vixen"], content: notes })],
  [fact("mira", "f-ears", "Ears", "", "Tall russet ears."), fact("mira", "f-form", "form", "vixen", "settled")],
);

// ---- request ----
const req = notesToFactsRequest(8000, { entry: mira });
ok(req.message.includes("Mira [character] (also: the vixen)"), "request names the entry with its aliases");
ok(req.message.includes(notes), "request has the whole of the notes");
ok(req.message.includes("- Ears [every form]: Tall russet ears.") && req.message.includes("Current form: vixen, settled"), "request lists the existing facts and the form");
ok(req.system!.includes("Reply with JSON only") && req.system!.includes("Personality") && req.system!.includes("plot events"), "system prompt: JSON only, the usual aspects, no plot");
const long = foldCodex([op("x", "Long", { content: "word ".repeat(30000) })])[0];
const fitted = notesToFactsRequest(4000, { entry: long });
ok(fitted.message.length < 20000 && fitted.message.includes("…"), "long notes are cut to fit");

// ---- parse ----
const reply = (facts: unknown[]) => JSON.stringify({ facts });
const good = parseNotesToFacts(
  reply([
    { kind: "set", aspect: "Eyes", text: "Amber eyes.", quote: "amber eyes" },
    { kind: "set", aspect: "Personality", form: "", text: "Shy around strangers.", quote: "She is shy around strangers." },
    { kind: "set", aspect: "ears", text: "Tall russet ears.", quote: "tall russet ears" },
    { kind: "set", aspect: "Hair", text: "Red hair.", quote: "her red hair" },
    { kind: "form", form: "half-changed", text: "", quote: "Currently half-changed" },
    { kind: "retire", aspect: "Ears", quote: "tall russet ears" },
    { kind: "entry", name: "Zed", quote: "young fox-girl" },
    { kind: "set", aspect: "Eyes", text: "Gold eyes.", quote: "amber eyes" },
  ]),
  { entry: mira },
);
ok(good.length === 3, "keeps the good items only: " + good.map((g) => `${g.kind}:${g.aspect}`).join());
ok(good[0].kind === "set" && good[0].entry_id === "mira" && good[0].aspect === "Eyes" && good[0].after === "Amber eyes." && good[0].quote === "amber eyes", "a set carries the entry, aspect, text and quote");
ok(!good.some((g) => g.aspect === "Hair"), "an item whose quote is not in the notes is dropped");
ok(!good.some((g) => g.aspect.toLowerCase() === "ears"), "a set equal to the existing fact is dropped");
ok(!good.some((g) => g.kind === "retire" || g.kind === "entry"), "retire and entry items are dropped");
ok(good.filter((g) => g.aspect === "Eyes").length === 1, "a second item for the same aspect is dropped");
const form = good.find((g) => g.kind === "form")!;
ok(form.form === "half-changed" && form.after === "" && form.aspect === "" && form.entry_id === "mira", "a form item maps to form/after");
const changed = parseNotesToFacts(reply([{ kind: "set", aspect: "ears", text: "Short ears.", quote: "tall russet ears" }, { kind: "form", form: "vixen", text: "settled", quote: "half-changed" }]), { entry: mira });
ok(changed.length === 1 && changed[0].aspect === "Ears" && changed[0].after === "Short ears.", "a changed text keeps the entry's own spelling of the aspect; an unchanged form is dropped");
let threw = false;
try { parseNotesToFacts("nothing here", { entry: mira }); } catch { threw = true; }
ok(threw && parseNotesToFacts('{"facts":"x"}', { entry: mira }).length === 0, "a reply with no JSON throws (the task fails and is retried); a wrong shape gives nothing");
ok(parseNotesToFacts(reply([{ aspect: "Eyes", text: "Amber eyes.", quote: "amber eyes" }]), { entry: mira }).length === 1, "a missing kind means set");
const many = parseNotesToFacts(reply(Array.from({ length: 30 }, (_, i) => ({ kind: "set", aspect: `A${i}`, text: "t", quote: "young fox-girl" }))), { entry: mira });
ok(many.length === MAX_NOTE_FACTS, "capped at the maximum");
