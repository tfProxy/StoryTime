import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";
import { ALWAYS_SHARE, alwaysIncludedLoad, entryHints, hintCount, LONG_FACT_WORDS, staleAlong, staleInTree } from "../../src/lib/codexHints.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
let n = 0;
const create = (over: Partial<CodexOp> = {}): CodexOp => ({
  id: `o${n++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", op: "create", name: "Mira", type: "character",
  aliases: ["the thief"], content: "", always_include: false, posted_at: 1, ...over,
});
const fact = (aspect: string, text: string, form = ""): FactOp => ({
  id: `f${n++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mira", fact_id: `id${n}`, op: "set", aspect, form, text, quote: "", posted_at: n,
});
const entry = (facts: FactOp[], over: Partial<CodexOp> = {}) => foldCodex([create(over)], facts)[0];
const keys = (e: ReturnType<typeof entry>, opts = {}) => entryHints(e, opts).map((h) => h.key.replace(/-id\d+$/, ""));

const ears = fact("Ears", "Round ears.");
ok(keys(entry([ears]), { chapterTexts: ["Mira ran."], contextTokens: 8000 }).length === 0, "a plain entry, mentioned by name, has no hints");

ok(keys(entry([], { content: "A thief from the docks." })).join() === "notes-only", "notes but no facts: the AI gets nothing");
ok(keys(entry([])).length === 0, "…an empty entry has no hint (nothing to warn about yet)");

ok(keys(entry([ears]), { chapterTexts: ["Nobody came."] }).join() === "unmentioned", "named in no chapter up to here");
ok(keys(entry([ears]), { chapterTexts: ["They saw the thief."] }).length === 0, "…a keyword counts as a mention");
ok(keys(entry([ears], { always_include: true }), { chapterTexts: ["Nobody came."] }).length === 0, "…an always-included entry needs no mention");
ok(keys(entry([ears]), {}).length === 0, "…and without the chapters it isn't checked");

const long = fact("History", Array.from({ length: LONG_FACT_WORDS + 1 }, (_, i) => `w${i}`).join(" "));
ok(keys(entry([long])).join() === "long", `a fact over ${LONG_FACT_WORDS} words is long`);
ok(keys(entry([fact("Ears", "Fox ears since chapter 3.")])).join() === "chapter", "a fact that mentions a chapter number");
ok(keys(entry([fact("Status", "Wounded in the last chapter.")])).join() === "chapter", "…or 'the last chapter'");
ok(keys(entry([fact("Role", "Chapter house guard.")])).length === 0, "…but not the word chapter on its own");

ok(keys(entry([ears, fact("Ear", "Pointed.")])).join() === "dup", "'Ear' and 'Ears' are the same aspect written two ways");
ok(keys(entry([ears, fact("Ear", "Fox ears.", "vixen")])).length === 0, "…unless they are for different forms");
ok(keys(entry([fact("Hair", "Red."), fact("Hair colour", "Red.")])).length === 0, "…and different aspects aren't flagged");

const big = entry(Array.from({ length: 12 }, (_, i) => fact(`Aspect${i}`, "x".repeat(150))));
ok(keys(big, { contextTokens: 8000 }).join() === "big", "an AI text over a quarter of the codex's share of the prompt is big");
ok(keys(big, { contextTokens: 100000 }).length === 0, "…not at a large context size");

// the fixes each hint offers
const dupEntry = entry([ears, fact("Ear", "Pointed.")]);
const dup = entryHints(dupEntry)[0];
ok(dup.duplicates?.length === 2 && dup.duplicates.every((id) => dupEntry.facts.some((f) => f.fact_id === id)), "a duplicate hint names both facts, so one can be kept");
ok(entryHints(entry([long]))[0].edit === entry([long]).facts[0].fact_id, "a long fact's hint opens that fact for editing");
ok(entryHints(entry([], { content: "Notes." }))[0].notes === true, "the notes-only hint offers Turn notes into facts");

// the count on a card: hints plus clashes between forms
const clashing = entry([ears, fact("Ears", "Fox ears.", "vixen"), fact("Form", "", "vixen")]);
ok(hintCount(clashing) === 1 && hintCount(entry([ears])) === 0, "a card's count includes facts that clash between forms");

// always-included entries crowding the prompt
const always = (name: string, size: number) => foldCodex([create({ entry_id: name, name, always_include: true })], [{ ...fact("Look", "x".repeat(size)), entry_id: name }])[0];
ok(alwaysIncludedLoad([always("a", 300), always("b", 300)], 8000) === null, "a few short always-included entries fit");
const load = alwaysIncludedLoad([always("small", 1000), always("large", 3000), entry([ears])], 8000);
ok(load !== null && load.names.join() === "large,small" && load.tokens > load.room * ALWAYS_SHARE, "past half the codex's room they are listed, biggest first: " + JSON.stringify(load));

// out of date: chapters that mention the entry since its last change
{
  const who = { name: "Mira", type: "character" as const, aliases: ["the thief"] };
  // c0 (created) -> c1 -> c2 -> c3 (changed) -> c4 -> c5 ; and c1 -> b2 -> b3 -> b4 on another branch
  const ch = (id: string, parent_id: string | null, body: string) => ({ id, parent_id, body });
  const tree = [
    ch("c0", null, "Mira waited."),
    ch("c1", "c0", "Mira ran."),
    ch("c2", "c1", "Nobody came."),
    ch("b2", "c1", "The thief hid."),
    ch("c3", "c2", "Mira changed."),
    ch("b3", "b2", "Mira hid again."),
    ch("c4", "c3", "Mira slept."),
    ch("b4", "b3", "Mira, again."),
    ch("c5", "c4", "Mira woke."),
  ];
  const changes = new Set(["c0", "c3"]);
  const path = (ids: string[]) => ids.map((id) => tree.find((c) => c.id === id)!);
  ok(staleAlong(path(["c0", "c1", "c2", "c3", "c4", "c5"]), { who, changes, checked: new Set() }) === 2, "along a path: mentions after the last change (c4, c5), not before it");
  ok(staleAlong(path(["c0", "c1", "c2"]), { who, changes, checked: new Set() }) === 1, "…up to the chapter shown");
  ok(staleAlong(path(["c0", "c1", "b2", "b3", "b4"]), { who, changes, checked: new Set() }) === 4, "…a keyword counts as a mention, and the other branch has no change");
  ok(staleAlong(path(["c0", "c1", "b2", "b3", "b4"]), { who, changes, checked: new Set(["b3"]) }) === 3, "…a chapter the codex check has read doesn't count");
  ok(staleAlong(path(["c0", "c1"]), { who, changes: new Set(["c1"]), checked: new Set() }) === 0, "…nothing counts before the entry starts");
  ok(staleInTree(tree, { who, changes, checked: new Set() }) === 4, "the whole story: the worst branch");
  ok(staleInTree(tree, { who, changes: new Set([...changes, "b3"]), checked: new Set() }) === 2, "…a change on that branch starts it again");
}
