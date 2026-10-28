import { foldCodex, storyEntrySummaries, retiredEntries, entryHistory, changedFields, addChange, draftOps, DRAFT_ANCHOR, type CodexChange, type CodexOp } from "../../src/lib/codex.ts";
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
