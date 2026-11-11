import { excerptsFor, fleshOutRequest, parseFleshOut, MAX_EXPAND_FACTS, type FleshOutOptions } from "../../src/lib/ai/fleshOutAi.ts";
import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

let n = 0;
const op = (entry_id: string, name: string, extra: Partial<CodexOp> = {}): CodexOp => ({
  id: `o${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, op: "create", name, type: "character", aliases: [], content: "", always_include: false, posted_at: n, ...extra,
});
const fact = (entry_id: string, fact_id: string, aspect: string, form: string, text: string): FactOp => ({
  id: `f${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, fact_id, op: "set", aspect, form, text, quote: "", posted_at: n,
});

const [mira] = foldCodex(
  [op("mira", "Mira", { aliases: ["the vixen"], content: "private notes" })],
  [fact("mira", "f-ears", "Ears", "", "Tall russet ears."), fact("mira", "f-form", "form", "vixen", "settled")],
);
const chapters = [
  { title: "Root", body: "A quiet morning in the village. Nothing happened.", summary: "The village wakes." },
  { title: "The Ferry", body: "Mira crouched on the ferry rail, flicking her tail. \"I don't trust the river,\" the vixen said. Zed laughed.", summary: "Mira meets Zed." },
];
const base: FleshOutOptions = { entry: mira, story: { title: "Foxfire", premise: "A girl turns into a fox.", style: "Warm, third person." }, others: ["Zed", "The River"], chapters };

// ---- request ----
let req = fleshOutRequest(8000, base);
ok(req.message.includes("Mira [character] (also: the vixen)") && req.message.includes("- Ears [every form]: Tall russet ears.") && req.message.includes("Current form: vixen, settled"), "request names the entry and lists its facts and form");
ok(req.message.includes("Premise: A girl turns into a fox.") && req.message.includes("Style notes: Warm, third person.") && req.message.includes("Other entries (do not clash with them): Zed, The River"), "request has the story, style and other entries");
ok(!req.message.includes("private notes"), "the entry's own notes are not sent");
ok(req.message.includes("Mira meets Zed.") && req.message.includes("Where the entry appears:") && req.message.includes("flicking her tail"), "request has the summaries and where the entry appears");
ok(req.system!.includes("Invent:") && !req.system!.includes("Stay close") && req.system!.includes("Reply with JSON only") && req.system!.includes("well-known works"), "the default mode invents, asks for JSON and allows known characters");
req = fleshOutRequest(8000, { ...base, mode: "close" });
ok(req.system!.includes("Stay close to the story") && req.system!.includes('Every fact needs "quote"') && !req.system!.includes("Invent:"), "close mode asks for quotes");
req = fleshOutRequest(8000, { ...base, hint: "her family and how she talks" });
ok(req.message.includes("The author wants more of: her family and how she talks"), "a hint is passed on");
const long = { ...base, chapters: Array.from({ length: 80 }, (_, i) => ({ title: `Ch ${i}`, body: `Mira did thing ${i}. ${"filler ".repeat(500)}`, summary: "" })) };
const fitted = fleshOutRequest(4000, long);
ok(fitted.message.length < 12000, "a long story is cut to fit: " + fitted.message.length);
ok(excerptsFor(mira, chapters, 10000).length === 1 && excerptsFor(mira, chapters, 10).length === 0, "excerpts come from chapters that name the entry, within the budget");

// ---- parse: invent ----
const reply = JSON.stringify({
  facts: [
    { aspect: "Voice", text: "Low and dry, with a habit of trailing off." },
    { aspect: "ears", text: "Floppy." }, // she has Ears already
    { aspect: "Tail", form: "vixen", text: "Bushy with a white tip." },
    { aspect: "Voice", text: "Duplicate aspect." },
    { aspect: "form", form: "pup", text: "x" },
    { aspect: "Habit", text: "" },
    "junk",
    { aspect: "Family", text: "An older brother who left for the city.", quote: "ignored when inventing" },
  ],
});
let got = parseFleshOut(reply, base);
ok(got.map((s) => s.aspect).join() === "Voice,Tail,Relationships", "invent: new aspects only, no repeats, no form change, filed under the list's names (Family is Relationships): " + got.map((s) => s.aspect).join());
ok(got.every((s) => s.kind === "set" && s.entry_id === "mira" && s.quote === ""), "…as set suggestions for the entry with no quote");
ok(got[1].form === "vixen" && got[0].after === "Low and dry, with a habit of trailing off.", "…keeping the form and the text");
const everyForm = parseFleshOut(JSON.stringify({ facts: [{ aspect: "Scent", form: "every form", text: "Woodsmoke." }, { aspect: "Paws", form: "vixen form", text: "Soft black paws." }, { aspect: "Gait", form: "vixen form", text: "Soft-footed." }] }), base);
ok(everyForm.length === 3 && everyForm[0].form === "" && everyForm[1].form === "vixen", "invent: form 'every form' is no form, 'vixen form' is 'vixen'");
ok(everyForm[2].aspect === "Mannerisms" && everyForm[2].form === "", "invent: Gait is filed under Mannerisms, which is the same in every form, so its form is dropped");
let threw = false;
try { parseFleshOut("nonsense", base); } catch { threw = true; }
ok(threw && parseFleshOut('{"facts":"x"}', base).length === 0, "an unreadable reply is an error; a reply of the wrong shape gives nothing");
ok(parseFleshOut('```json\n{"facts":[{"aspect":"Gait","text":"Soft-footed."}]}\n```', base).length === 1, "a fenced reply is read");
const many = JSON.stringify({ facts: Array.from({ length: 30 }, (_, i) => ({ aspect: `A${i}`, text: `t${i}` })) });
ok(parseFleshOut(many, base).length === MAX_EXPAND_FACTS, "there is a limit");

// ---- parse: close ----
const closeReply = JSON.stringify({
  facts: [
    { aspect: "Wariness", text: "Distrusts the river.", quote: "I don't trust the river" },
    { aspect: "Posture", text: "Crouches on rails.", quote: "Mira crouched on the ferry rail" },
    { aspect: "Pride", text: "Proud.", quote: "words that are not in the chapters" },
    { aspect: "Humour", text: "Dry." },
  ],
});
got = parseFleshOut(closeReply, { ...base, mode: "close" });
ok(got.map((s) => s.aspect).join() === "Wariness,Mannerisms" && got[0].quote === "I don't trust the river", "close: only facts whose quote is in the chapters, with the quote: " + got.map((s) => s.aspect).join());
