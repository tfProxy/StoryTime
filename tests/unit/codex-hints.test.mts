import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";
import { entryHints, LONG_FACT_WORDS } from "../../src/lib/codexHints.ts";

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
