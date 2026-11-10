import { foldFacts, factHistory, describeEntry, formClashes, compareEntry, overriddenFacts, applicableFacts, factLinesForEditing, describeSharedFacts, type FactOp, type LiveFact } from "../../src/lib/codex.ts";
import { baseForms, foldCodex, storyEntrySummaries, retiredEntries, entryHistory, changedFields, addChange, draftOps, DRAFT_ANCHOR, type CodexChange, type CodexOp } from "../../src/lib/codex.ts";
import { buildCodexBlock, mentions, generatePrompt, refinePrompt, choicesPrompt } from "../../src/lib/ai/prompts.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
let n = 0;
const op = (over: Partial<CodexOp>): CodexOp => ({
  id: `o${n++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", op: "create", name: "Mira", type: "character",
  aliases: [], content: "A human thief.", always_include: false, posted_at: 1000 + n, ...over,
});

// fold basics
let s = foldCodex([op({})]);
ok(s.length === 1 && s[0].content === "A human thief.", "create");
s = foldCodex([op({}), op({ op: "replace", anchor_depth: 3, anchor_chapter_id: "c3", content: "A horse." })]);
ok(s.length === 1 && s[0].content === "A horse." && s[0].op.anchor_chapter_id === "c3", "deeper replace overrides");
// deeper wins even if the shallower op was posted LATER (retroactive edit at an ancestor)
s = foldCodex([
  op({ anchor_depth: 3, anchor_chapter_id: "c3", op: "replace", content: "A horse.", posted_at: 1000 }),
  op({ anchor_depth: 1, anchor_chapter_id: "c1", op: "replace", content: "A human, retconned.", posted_at: 9000 }),
  op({ posted_at: 10 }),
]);
ok(s[0].content === "A horse.", "retroactive ancestor op doesn't override a deeper op");
// same anchor: later post wins
s = foldCodex([op({ posted_at: 1 }), op({ op: "replace", content: "v2", posted_at: 5 }), op({ op: "replace", content: "v3", posted_at: 9 })]);
ok(s[0].content === "v3", "same anchor: latest post wins");
// same anchor, identical timestamps: input order wins
s = foldCodex([op({ posted_at: 5 }), op({ op: "replace", content: "second", posted_at: 5 })]);
ok(s[0].content === "second", "ties keep given order");
// retire / revive
const base = [op({}), op({ op: "retire", anchor_depth: 2, anchor_chapter_id: "c2" })];
ok(foldCodex(base).length === 0, "retire removes");
ok(retiredEntries(base).length === 1 && retiredEntries(base)[0].name === "Mira", "retired list");
const revived = [...base, op({ op: "replace", anchor_depth: 4, anchor_chapter_id: "c4", content: "Back!" })];
ok(foldCodex(revived).length === 1 && foldCodex(revived)[0].content === "Back!" && retiredEntries(revived).length === 0, "replace after retire revives");
ok(foldCodex([op({ op: "replace", entry_id: "ghost", name: "Ghost" })]).length === 1, "replace of unknown entry creates it");
// ordering / grouping
s = foldCodex([op({ entry_id: "a", name: "Zed", type: "place" }), op({ entry_id: "b", name: "Amy", type: "character" }), op({ entry_id: "c", name: "Bob", type: "character" })]);
ok(s.map((e) => e.name).join() === "Amy,Bob,Zed", "sorted by type then name");
// history + diff summary
const h = entryHistory([op({ posted_at: 1 }), op({ entry_id: "other" }), op({ op: "replace", content: "x", aliases: ["M"], posted_at: 2 })], "mira");
ok(h.length === 2 && changedFields(h[0], h[1]).join() === "aliases,content" && changedFields(undefined, h[0]).join() === "created", "history + changed fields");

// prompt selection
const e = (name: string, content: string, extra: any = {}) => ({ name, type: "character", aliases: [], content, always_include: false, ...extra });
ok(mentions(e("Mira", "x"), "Then Mira, quietly, left."), "mentions: name");
ok(!mentions(e("Mira", "x"), "Miranda arrived."), "mentions: whole word only");
ok(mentions(e("Mira", "x", { aliases: ["the thief"] }), "Nobody saw The Thief go."), "mentions: alias, case-insensitive");
ok(mentions(e("O'Brien (Cap.)", "x"), "said O'Brien (Cap.) hello") && !mentions(e("a+b", "x"), "ab"), "mentions: regex-special names safe");
ok(mentions(e("Ã…sa", "x"), "SÃ¥ sa Ã…sa."), "mentions: unicode");
let block = buildCodexBlock([e("Mira", "thief"), e("Bram", "smith"), e("King", "rules", { always_include: true })], "Mira walked.", 1000);
ok(block.includes("Mira") && block.includes("King") && !block.includes("Bram"), "block: triggered + always, not unrelated");
ok(block.indexOf("King") < block.indexOf("Mira"), "block: always-included first");
block = buildCodexBlock([e("Big", "x".repeat(4000), { always_include: true }), e("Small", "tiny", { always_include: true })], "", 200);
ok(!block.includes("Big") && block.includes("Small"), "block: over-budget entry skipped, smaller one kept");
ok(buildCodexBlock([e("Mira", "t")], "nothing relevant", 500) === "", "block: empty when nothing triggers");

const ctx = { storyTitle: "T", premise: "P", choiceLabel: "Go", path: [{ title: "C1", body: "Mira ran.", summary: null, path_summary: null }],
  codex: [e("Mira", "now a horse"), e("Bram", "smith")] };
const g = generatePrompt(ctx, "", "short", 8000);
ok(g.includes("Codex") && g.includes("Mira [character]: now a horse") && !g.includes("Bram"), "generate prompt carries triggered codex");
ok(generatePrompt(ctx, "Bram appears", "short", 8000).includes("Bram [character]"), "direction text triggers entries");
ok(refinePrompt(ctx, { title: "t", body: "Bram hammers" }, "more", 8000).includes("Bram"), "draft body triggers entries when revising");
ok(choicesPrompt(ctx, { title: "t", body: "x" }, [], 8000).includes("Mira"), "choices prompt carries codex");
ok(!generatePrompt({ ...ctx, codex: [] }, "", "short", 8000).includes("Codex"), "no codex block when empty");

// changes held in a draft
const chg = (over: Partial<CodexChange>): CodexChange => ({ op: "replace", entry_id: "mira", name: "Mira", type: "character", aliases: [], content: "x", always_include: false, ...over });
let held = addChange([], chg({ op: "create", entry_id: "draft-1", name: "Zed" }));
held = addChange(held, chg({ op: "replace", entry_id: "draft-1", name: "Zed", content: "edited" }));
ok(held.length === 1 && held[0].op === "create" && held[0].content === "edited", "editing an entry made in the draft keeps it a create");
held = addChange(held, chg({ content: "a horse" }));
held = addChange(held, chg({ content: "a winged horse" }));
ok(held.length === 2 && held.filter((c) => c.entry_id === "mira").length === 1 && held[1].content === "a winged horse", "one change per entry, latest wins");
held = addChange(held, chg({ op: "retire", entry_id: "draft-1" }));
ok(held.length === 1 && held[0].entry_id === "mira", "retiring an entry made in the draft drops it");
const onPath = [op({ anchor_depth: 2, anchor_chapter_id: "c2", op: "replace", content: "deep", posted_at: 99999 })];
const folded = foldCodex([...onPath, ...draftOps(held, 3)]);
ok(folded[0].content === "a winged horse" && folded[0].op.anchor_chapter_id === DRAFT_ANCHOR, "draft changes override the path's codex");
ok(retiredEntries([...onPath,...draftOps([chg({ op: "retire" })], 3)]).length === 1, "a retire held in the draft hides the entry");

// story-wide entry summaries
{
  const titles = new Map([["c0", "One"], ["c1", "Two"], ["c3", "Four"]]);
  const sum = storyEntrySummaries([
    op({ entry_id: "mira", name: "Mira", posted_at: 1 }),
    op({ entry_id: "mira", op: "replace", name: "Mira the Bold", anchor_depth: 3, anchor_chapter_id: "c3", posted_at: 2 }),
    op({ entry_id: "zed", name: "zed", type: "place", anchor_depth: 1, anchor_chapter_id: "c1", posted_at: 3 }),
    op({ entry_id: "zed", op: "retire", name: "", anchor_depth: 3, anchor_chapter_id: "c3", posted_at: 4 }),
    op({ entry_id: "abe", name: "Abe", type: "item", posted_at: 5 }),
    op({ entry_id: "draft-1", name: "Draft", posted_at: 6 }),
  ], titles);
  ok(sum.map((s) => s.entry_id).join() === "abe,mira,zed", "summaries: sorted by name, case-insensitive, drafts left out");
  ok(sum[1].name === "Mira the Bold" && sum[1].first_chapter_id === "c0" && sum[1].first_chapter_title === "One", "summaries: latest name, first chapter from the create");
  ok(sum[2].retired && sum[2].name === "zed" && sum[2].type === "place" && sum[2].first_chapter_title === "Two", "summaries: retire sets retired and keeps the last name");
  ok(!sum[0].retired && sum[0].type === "item", "summaries: live entries are not retired");
}

// ---- facts ----
{
  let m = 0;
  const fop = (over: Partial<FactOp>): FactOp => ({
    id: `f${m++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id: "ears", op: "set", aspect: "Ears", form: "",
    text: "Round ears.", quote: "", posted_at: 100 + m, ...over,
  });
  const ears = (l: Map<string, LiveFact[]>) => l.get("mira") ?? [];

  ok(ears(foldFacts([fop({})])).length === 1, "facts: set");
  let live = foldFacts([fop({}), fop({ text: "Tall ears.", anchor_depth: 1, anchor_chapter_id: "c1" })]);
  ok(ears(live).length === 1 && ears(live)[0].text === "Tall ears.", "facts: a later set with the same fact_id replaces");
  live = foldFacts([fop({}), fop({ op: "retire", anchor_depth: 2, anchor_chapter_id: "c2" })]);
  ok(ears(live).length === 0, "facts: retire removes it");
  live = foldFacts([
    fop({ anchor_depth: 3, anchor_chapter_id: "c3", text: "Deep.", posted_at: 1 }),
    fop({ anchor_depth: 1, anchor_chapter_id: "c1", text: "Retconned.", posted_at: 9000 }),
  ]);
  ok(ears(live)[0].text === "Deep.", "facts: the deeper anchor wins even if posted earlier");
  ok(factHistory([fop({}), fop({ fact_id: "eyes" }), fop({ op: "retire", anchor_depth: 1 })], "ears").length === 2, "facts: history lists the versions of one fact");

  const lf = (o: Partial<FactOp>): LiveFact => { const f = fop(o); return { fact_id: f.fact_id, aspect: f.aspect, form: f.form, text: f.text, quote: f.quote, op: f }; };
  const formFact = lf({ fact_id: "form", aspect: "form", form: "vixen", text: "change complete" });
  let d = describeEntry([formFact, lf({ text: "Fox ears." }), lf({ fact_id: "tail", aspect: "Tail", form: "vixen", text: "Bushy tail." }), lf({ fact_id: "tail2", aspect: "Tail", form: "human", text: "No tail." }), lf({ fact_id: "loose", aspect: "", text: "Hates rain" })]);
  ok(d === "Form: vixen, change complete. Ears: Fox ears. Tail: Bushy tail. Hates rain.", "describe: form first, current form's facts, then loose facts: " + d);
  d = describeEntry([lf({ text: "Fox ears." })]);
  ok(d === "Ears: Fox ears.", "describe: no form");
  d = describeEntry([lf({ fact_id: "tail2", aspect: "Tail", form: "human", text: "No tail." })]);
  ok(d === "", "describe: a form fact without a current form doesn't apply");
  d = describeEntry([lf({ anchor_chapter_id: "prev", text: "Fox ears." }), lf({ fact_id: "x", aspect: "Eyes", text: "Green." })], "prev");
  ok(d === "Ears: Fox ears (just changed). Eyes: Green.", "describe: recent anchor is marked: " + d);

  let es = foldCodex([op({})], [fop({}), fop({ fact_id: "form", aspect: "form", form: "vixen", text: "" })]);
  ok(es[0].facts.length === 2 && es[0].form?.name === "vixen" && es[0].forms.join() === "vixen" && es[0].description === "Ears: Round ears.", "foldCodex: facts folded into the entry; its only form is its normal one, so the AI isn't told it: " + es[0].description);
  es = foldCodex([op({}), op({ op: "retire", anchor_depth: 1, anchor_chapter_id: "c1" })], [fop({})]);
  ok(es.length === 0, "foldCodex: a retired entry drops its facts");
  es = foldCodex([op({})]);
  ok(es[0].description === "" && es[0].content !== "" && es[0].facts.length === 0 && es[0].form === null, "foldCodex: no facts gives an empty description (the notes stay in content)");
  es = foldCodex([op({})], [fop({ anchor_chapter_id: "c1" })], { recentAnchor: "c1" });
  ok(es[0].description.includes("(just changed)"), "foldCodex: recentAnchor passes through");
}

// ---- entry ops fold field by field: a later edit at an earlier chapter reaches the chapters below ----
{
  const c0 = (o: Partial<CodexOp>) => op({ anchor_chapter_id: "c0", anchor_depth: 0, ...o });
  const c2 = (o: Partial<CodexOp>) => op({ anchor_chapter_id: "c2", anchor_depth: 2, op: "replace", ...o });
  // c2 changes the notes first; later a keyword is added at c0 (its op copies the old notes as seen at c0).
  let es = foldCodex([
    c0({ posted_at: 1 }),
    c2({ content: "Notes at c2.", posted_at: 2 }),
    c0({ op: "replace", aliases: ["Mi"], posted_at: 3 }),
  ]);
  ok(es[0].aliases.join() === "Mi" && es[0].content === "Notes at c2.", "a keyword added later at the first chapter reaches a chapter that changed only its notes");
  ok(es[0].keywordSources.length === 1 && es[0].keywordSources[0].chapter_id === "c0", "…and it is shown as coming from the first chapter");
  // both chapters add a keyword: both are kept, each with its own source
  es = foldCodex([
    c0({ posted_at: 1 }),
    c2({ aliases: ["Thief"], posted_at: 2 }),
    c0({ op: "replace", aliases: ["Mi"], posted_at: 3 }),
  ]);
  const src = Object.fromEntries(es[0].keywordSources.map((k) => [k.alias, k.chapter_id]));
  ok(es[0].aliases.length === 2 && src.Mi === "c0" && src.Thief === "c2", "keywords added at two chapters are both kept, with where they came from");
  // a keyword removed at c2 stays removed there, while one added later at c0 arrives
  es = foldCodex([
    c0({ aliases: ["Old"], posted_at: 1 }),
    c2({ aliases: [], posted_at: 2 }),
    c0({ op: "replace", aliases: ["Old", "New"], posted_at: 3 }),
  ]);
  ok(es[0].aliases.join() === "New", "a keyword removed below stays removed, and a later one from above arrives");
  // a field the deeper op did change still wins over a later change above
  es = foldCodex([c0({ posted_at: 1 }), c2({ name: "Mira the Mare", posted_at: 2 }), c0({ op: "replace", name: "Mira Vale", posted_at: 3 })]);
  ok(es[0].name === "Mira the Mare", "a field changed below still wins there");
  es = foldCodex([c0({ posted_at: 1 }), c0({ op: "replace", name: "Mira Vale", posted_at: 3 })]);
  ok(es[0].name === "Mira Vale", "…and the change above applies where nothing below changed it");
  // removed from one chapter only: retired at c1, revived at c2 with the same fields; a later keyword at c0 still arrives at c2
  const c1 = (o: Partial<CodexOp>) => op({ anchor_chapter_id: "c1", anchor_depth: 1, ...o });
  const removed = [c0({ posted_at: 1 }), c1({ op: "retire", posted_at: 2 }), c2({ posted_at: 2 })];
  ok(foldCodex(removed.filter((o) => o.anchor_depth <= 1)).length === 0, "removed from one chapter: not there");
  ok(retiredEntries(removed.filter((o) => o.anchor_depth <= 1)).length === 1, "…where it is listed as retired");
  es = foldCodex([...removed, c0({ op: "replace", aliases: ["Mi"], posted_at: 4 })]);
  ok(es.length === 1 && es[0].aliases.join() === "Mi" && es[0].content === "A human thief.", "…but back in the chapter below, with a keyword added later above");
}

// ---- base form: an entry's normal form isn't mentioned to the AI ----
{
  let k = 0;
  const entry = [{ id: "o1", anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", op: "create", name: "Mira", type: "character", aliases: [], content: "", always_include: false, posted_at: 1 } as CodexOp];
  const f = (over: Partial<FactOp>): FactOp => ({
    id: `bf${k++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id: "ears", op: "set", aspect: "Ears", form: "", text: "Round ears.", quote: "", posted_at: 10 + k, ...over,
  });
  const form = (anchor: string, depth: number, name: string, text = "", extra: Partial<FactOp> = {}) =>
    f({ anchor_chapter_id: anchor, anchor_depth: depth, fact_id: "form", aspect: "form", form: name, text, ...extra });
  // (Set after the ears, so they are listed after them.)
  const human = f({ fact_id: "t1", aspect: "Tail", form: "human", text: "No tail.", posted_at: 5000 });
  const vixen = f({ fact_id: "t2", aspect: "Tail", form: "vixen", text: "Bushy tail.", posted_at: 5001 });

  let es = foldCodex(entry, [f({}), human, vixen, form("c0", 0, "human")]);
  ok(es[0].baseForm === "human" && es[0].description === "Ears: Round ears. Tail: No tail.", "base form: in its normal form the line is left out but its facts apply: " + es[0].description);
  ok(es[0].form?.name === "human", "…the entry still has its form");

  es = foldCodex(entry, [f({}), human, vixen, form("c0", 0, "human"), form("c2", 2, "vixen", "half-changed")]);
  ok(es[0].baseForm === "human" && es[0].description === "Form: vixen, half-changed. Ears: Round ears. Tail: Bushy tail.", "another form is told to the AI, with its facts: " + es[0].description);

  const back = [f({}), human, vixen, form("c0", 0, "human"), form("c2", 2, "vixen"), form("c3", 3, "human", "", { id: "bf-back" })];
  es = foldCodex(entry, back);
  ok(es[0].description === "Ears: Round ears. Tail: No tail.", "back in its normal form, the line is left out again: " + es[0].description);
  es = foldCodex(entry, back, { recentAnchor: "c3" });
  ok(es[0].description === "Form: human (just changed). Ears: Round ears. Tail: No tail.", "…except in the chapter after it changed back, so the story shows the change: " + es[0].description);
  es = foldCodex(entry, [f({}), human, form("c0", 0, "human", "settled")]);
  ok(es[0].description === "Form: human, settled. Ears: Round ears. Tail: No tail.", "a note on the normal form (a stage) is still told: " + es[0].description);

  // the form taken away: it reads as in its normal form
  es = foldCodex(entry, [f({}), human, vixen, form("c0", 0, "human"), form("c2", 2, "vixen"), form("c3", 3, "", "", { op: "retire" })]);
  ok(es[0].form === null && es[0].baseForm === "human" && es[0].description === "Ears: Round ears. Tail: No tail.", "with the form removed the entry reads as in its normal form: " + es[0].description);

  // never had a form: facts of a form can't apply (the entry page asks for a form)
  es = foldCodex(entry, [f({}), human]);
  ok(es[0].baseForm === null && es[0].form === null && es[0].forms.join() === "human" && es[0].description === "Ears: Round ears.", "no form ever set: form facts are left out: " + es[0].description);

  // the first form is the base, wherever it was given
  es = foldCodex(entry, [f({}), human, vixen, form("c2", 2, "vixen"), form("c4", 4, "human", "", { id: "bf-late" })]);
  ok(es[0].baseForm === "vixen" && es[0].description === "Form: human. Ears: Round ears. Tail: No tail.", "the first form given is the base: " + es[0].description);
  ok(baseForms([]).size === 0, "no facts, no base forms");
}

// form clashes: an every-form fact whose aspect a form also describes
{
  const lf = (fact_id: string, aspect: string, form: string, text: string): LiveFact =>
    ({ fact_id, aspect, form, text, quote: "", op: { id: fact_id, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id, op: "set", aspect, form, text, quote: "", posted_at: 1 } });
  const facts = [
    lf("ears", "Ears", "", "Round ears."),
    lf("vears", "ears", "vixen", "Fox ears."),
    lf("pers", "Personality", "", "Stubborn."),
    lf("tail", "Tail", "human", "No tail."),
    lf("form", "Form", "vixen", ""),
    lf("loose", "", "", "Hums when nervous."),
  ];
  let c = formClashes({ facts, forms: ["vixen", "human"] });
  ok(c.length === 1 && c[0].every.fact_id === "ears" && c[0].clashes.map((x) => x.form).join() === "vixen", "an every-form fact clashes with a form's fact of the same aspect (any capitals)");
  ok(c[0].fitsIn.join() === "human", "…and still fits the forms without their own");
  c = formClashes({ facts: [...facts, lf("wears", "Ears", "wolf", "Wolf ears.")], forms: ["vixen", "human", "wolf"] });
  ok(c.length === 1 && c[0].clashes.length === 2 && c[0].fitsIn.join() === "human", "one every-form fact can clash with several forms");
  c = formClashes({ facts: [...facts, lf("hears", "Ears", "human", "Round ears.")], forms: ["vixen", "human"] });
  ok(c[0].fitsIn.length === 0, "when every form has its own, it fits none");
  ok(formClashes({ facts: facts.filter((f) => f.fact_id !== "vears"), forms: ["vixen", "human"] }).length === 0, "no clash without a form's own fact");
}

// a form's own fact replaces the every-form fact of the same aspect, while the entry is in that form
{
  let k = 0;
  const fo = (fact_id: string, aspect: string, text: string, form = ""): FactOp => ({
    id: `of${k++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id, op: "set", aspect, form, text, quote: "", posted_at: k,
  });
  const at = (facts: FactOp[]) => foldCodex([op({})], facts)[0];
  const shared = [
    fo("ears", "Ears", "Round human ears."),
    fo("vears", "EARS ", "Tall fox ears.", "Vixen"),
    fo("pers", "Personality", "Stubborn."),
    fo("htail", "Tail", "No tail.", "human"),
    fo("loose", "", "Hums when nervous."),
  ];
  let e = at([...shared, fo("form", "Form", "", "human"), fo("form", "Form", "", "vixen")]);
  ok(e.description === "Form: vixen. EARS: Tall fox ears. Personality: Stubborn. Hums when nervous.", "in the form, its own fact replaces the every-form one (any capitals): " + e.description);
  ok(overriddenFacts(e).join() === "ears", "overriddenFacts names the replaced every-form fact");
  ok(!applicableFacts(e.facts, "vixen").some((f) => f.fact_id === "ears"), "applicableFacts leaves it out");
  ok(e.description.includes("Personality: Stubborn.") && e.description.includes("Hums when nervous."), "facts without a form version are kept");
  const lines = factLinesForEditing(e);
  ok(lines.includes("- Ears [every form; not in use now, the vixen form's own replaces it]: Round human ears.") && lines.includes("- EARS [Vixen form]: Tall fox ears."), "the fact lists for AI edits mark the replaced fact: " + lines.join(" | "));

  e = at([...shared, fo("form", "Form", "", "human")]);
  ok(e.description === "Ears: Round human ears. Personality: Stubborn. Tail: No tail. Hums when nervous.", "in another form the every-form fact is used: " + e.description);
  ok(overriddenFacts(e).length === 0 && factLinesForEditing(e).includes("- Ears [every form]: Round human ears."), "…and nothing is overridden");

  e = at(shared);
  ok(e.form === null && e.baseForm === null && e.description === "Ears: Round human ears. Personality: Stubborn. Hums when nervous.", "with no form the every-form fact is used: " + e.description);
  ok(overriddenFacts(e).length === 0, "…and nothing is overridden");
  ok(describeSharedFacts([...shared, fo("form", "Form", "", "vixen")].map((f) => ({ id: f.fact_id, aspect: f.aspect, form: f.form, text: f.text }))) === "EARS: Tall fox ears. Personality: Stubborn. Hums when nervous.", "a shared entry follows the same rule");
}

// comparing an entry between two chapters
{
  let k = 0;
  const fo = (fact_id: string, aspect: string, text: string, form = ""): FactOp => ({
    id: `cf${k++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id, op: "set", aspect, form, text, quote: "", posted_at: k,
  });
  const at = (facts: FactOp[], over: Partial<CodexOp> = {}) => foldCodex([op({ aliases: ["the thief"], ...over })], facts)[0];
  const before = at([fo("ears", "Ears", "Round ears."), fo("hair", "Hair", "Long red hair."), fo("pers", "Personality", "Stubborn."), fo("form", "Form", "", "human")]);
  const after = at(
    [fo("ears", "Ears", "Tall fox ears."), fo("pers", "Personality", "Stubborn."), fo("tail", "Tail", "A bushy tail.", "vixen"), fo("form", "Form", "", "vixen"), fo("form", "Form", "halfway", "vixen")],
    { aliases: ["the thief", "Vix"], always_include: true, content: "Changed at the well." },
  );
  const changes = compareEntry(before, after);
  const find = (label: string) => changes.find((c) => c.label === label);
  ok(find("Form")?.before === "human" && find("Form")?.after === "vixen, halfway", "the form and its stage: " + JSON.stringify(find("Form")));
  ok(find("Ears")?.before === "Round ears." && find("Ears")?.after === "Tall fox ears.", "a changed fact shows before and after");
  ok(find("Hair")?.before === "Long red hair." && find("Hair")?.after === undefined, "a removed fact has only before");
  ok(find("Tail (vixen)")?.after === "A bushy tail." && find("Tail (vixen)")?.before === undefined, "an added fact has only after, with its form");
  ok(!find("Personality"), "an unchanged fact isn't listed");
  ok(find("Keywords")?.after === "Vix" && find("Keywords")?.before === undefined, "a keyword added");
  ok(find("Always include")?.after === "on" && find("Notes (not sent to the AI)")?.after === "Changed at the well.", "Always include and the notes");
  ok(compareEntry(before, before).length === 0, "the same entry has no changes");

  // two branches set the same aspect as separate facts: read as one change, not a removal and an addition
  const branchA = at([fo("ears-a", "Ears", "Round ears.")]);
  const branchB = at([fo("ears-b", "ears", "Wolf ears.")]);
  const across = compareEntry(branchA, branchB);
  ok(across.length === 1 && across[0].before === "Round ears." && across[0].after === "Wolf ears.", "the same aspect on two branches is one change: " + JSON.stringify(across));
  // a fact moved to a form keeps its id: the label says so
  const moved = compareEntry(at([fo("ears", "Ears", "Round ears.")]), at([fo("ears", "Ears", "Round ears.", "human")]));
  ok(moved.length === 1 && moved[0].label === "Ears → Ears (human)", "a fact moved to a form: " + JSON.stringify(moved));
}
