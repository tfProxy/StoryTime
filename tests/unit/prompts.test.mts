import { parseBracketNotes, parseInstruction, SYSTEM_CHAPTER, refinePrompt, passageRefinePrompt, choicesPrompt, buildStorySoFar, parseChapterOutput, parseChoices, generatePrompt, estimateTokens, explainCodex, buildCodexBlock, ideasPrompt, parseIdeas, parseChoiceLabel } from "../../src/lib/ai/prompts.ts";
const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const ch = (n: number, extra: any = {}) => ({ title: `Ch${n}`, body: `body${n} `.repeat(200), summary: null, path_summary: null, ...extra });
const path = [1,2,3,4,5,6].map((n) => ch(n));
let s = buildStorySoFar(path, 100000);
ok(path.every((c) => s.includes(`### ${c.title}`)) && !s.includes("Earlier in the story"), "big budget: all verbatim");
s = buildStorySoFar(path, 1500);
ok(s.includes("### Ch6") && !s.includes("### Ch1") && s.includes("Earlier in the story") && s.includes("- Ch1:"), "small budget: latest verbatim, older condensed");
ok(estimateTokens(s) < 2200, "stays near budget: " + estimateTokens(s));
const withPS = path.map((c, i) => (i === 3 ? { ...c, path_summary: "PS-THROUGH-4" } : c));
s = buildStorySoFar(withPS, 1500);
ok(!s.includes("- Ch1:") || s.includes("PS-THROUGH-4") || s.includes("### Ch4"), "path_summary used when it covers the gap");
s = buildStorySoFar([ch(1, { body: "x".repeat(100000) })], 1000);
ok(s.includes("### Ch1") && s.length < 6000, "huge single chapter trimmed: " + s.length);
ok(buildStorySoFar([], 1000) === "", "empty path");
let p = parseChapterOutput("# The Door\n\nIt creaked.\n\nShe entered.");
ok(p.title === "The Door" && p.body === "It creaked.\n\nShe entered.", "parse title+body");
p = parseChapterOutput("# The Do"); ok(p.title === null && p.body === "", "partial title");
p = parseChapterOutput("No title here"); ok(p.title === null && p.body === "No title here", "no title");
ok(JSON.stringify(parseChoices('Sure! ["Open the door", "Run", "Hide."]')) === '["Open the door","Run","Hide."]', "choices json");
ok(JSON.stringify(parseChoices('1. Open it\n2. "Run away"\n- Hide')) === '["Open it","Run away","Hide"]', "choices lines");
const g = generatePrompt({ storyTitle: "T", premise: "P", path: [ch(1)], choiceLabel: "Go" }, "dragons", "short", 8000);
ok(g.includes("Premise: P") && g.includes('The reader chose: "Go"') && g.includes("dragons") && g.includes("about 300 words"), "generate prompt contents");
ok(!g.includes("Style notes"), "no style notes section when the story has none");
const styled = { storyTitle: "T", premise: "P", style: "  First person, past tense.\nNo gore.  ", path: [ch(1)], choiceLabel: "Go" };
const gs = generatePrompt(styled, "", "short", 8000);
ok(gs.includes("Style notes from the author (follow these in everything you write):\nFirst person, past tense.\nNo gore.") && gs.indexOf("Style notes") < gs.indexOf("Most recent chapters"), "style notes go in the story header, before the story so far");
ok(ideasPrompt(styled, 8000).includes("No gore.") && choicesPrompt(styled, { title: "x", body: "y" }, [], 8000).includes("No gore."), "…and into the ideas and choice prompts too");
ok(!SYSTEM_CHAPTER.includes("many people"), "the system prompt doesn't describe a shared, many-writer story");

// ---- prompt guidance ----
const base = { storyTitle: "T", premise: "P", path: [ch(1)], choiceLabel: null };
ok(SYSTEM_CHAPTER.includes("Pick up exactly where the story left off") && SYSTEM_CHAPTER.includes("open situation with real stakes"), "chapter system prompt covers the opening and the ending");
ok(refinePrompt(base, { title: "A", body: "B" }, "snappier", 8000).includes("keep every other sentence exactly as written"), "refine prompt keeps untouched text");
ok(passageRefinePrompt(base, { title: "A", before: "x ", passage: "y", after: " z" }, "shorter", 8000).includes("keep roughly the same length"), "passage prompt keeps the length");
ok(choicesPrompt(base, { title: "A", body: "B" }, [], 8000).includes("meaningfully different outcomes") && ip0().includes("meaningfully different outcomes") && ip0().includes("differ in kind"), "choice and idea prompts say what a good choice is");
function ip0() { return ideasPrompt(base, 8000); }

// ---- [bracketed notes] are extra instructions ----
let bn = parseBracketNotes("Jim picks up the ring [he does not slip it on, he is nervous].");
ok(bn.text === "Jim picks up the ring." && bn.notes.join("|") === "he does not slip it on, he is nervous", "parseBracketNotes: pulls the note out and tidies the gap");
bn = parseBracketNotes("[be brief] Jim waits [  no   dialogue ] and [] leaves [unclosed");
ok(bn.text === "Jim waits and leaves [unclosed" && bn.notes.join("|") === "be brief|no dialogue", "parseBracketNotes: several notes, empty ones dropped, unclosed bracket kept");
ok(parseBracketNotes("plain").notes.length === 0 && parseBracketNotes("plain").text === "plain", "parseBracketNotes: no brackets changes nothing");
ok(parseInstruction("[make it tenser]").text === "make it tenser" && parseInstruction("[make it tenser]").notes.length === 0, "parseInstruction: notes alone become the request");
const gb = generatePrompt(base, "Jim picks up the ring [he does not slip it on, he is nervous]", "short", 8000);
ok(gb.includes("Direction from the author: Jim picks up the ring\n") && gb.includes("Additional instructions from the author") && gb.includes("- he does not slip it on, he is nervous") && !gb.includes("[he does"), "generate prompt gives bracketed text as additional instructions");
const gn = generatePrompt(base, "[keep it light]", "short", 8000);
ok(gn.includes("Use your own judgment") && gn.includes("- keep it light"), "generate prompt: notes without a direction still apply");
ok(!generatePrompt(base, "dragons", "short", 8000).includes("Additional instructions"), "no notes, no extra block");
const rb = refinePrompt(base, { title: "A", body: "B" }, "add dialogue [Mira does the talking]", 8000);
ok(rb.includes("this instruction: add dialogue\n") && rb.includes("- Mira does the talking"), "refine prompt: notes become additional instructions");
ok(refinePrompt(base, { title: "A", body: "B" }, "[shorter]", 8000).includes("this instruction: shorter\n"), "refine prompt: only a note is still the instruction");
ok(passageRefinePrompt(base, { title: "A", before: "x ", passage: "y", after: " z" }, "tighter [keep the pun]", 8000).includes("- keep the pun"), "passage prompt: notes become additional instructions");
const ib = ideasPrompt(base, 8000, "cats attack [none of them die]");
ok(ib.includes('guidance: "cats attack"') && ib.includes("- none of them die") && !ib.includes("[none"), "ideas prompt: notes apply to every idea");

// ---- codex picking and manual overrides ----
const cx = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, type: "character", aliases: [] as string[], content: `${name} info`, always_include: false, ...extra });
const entries = [cx("a", "Mira"), cx("b", "Zed"), cx("c", "Rule", { always_include: true })];
let rows = explainCodex(entries, "Mira walked.", 1000);
ok(rows.map((r) => r.state).join() === "included,off,included" && rows[0].auto === "mentioned" && rows[2].auto === "always", "explainCodex: mentioned and always entries are included");
rows = explainCodex(entries, "Mira walked.", 1000, { include: ["b"], exclude: ["a", "c"] });
ok(rows.map((r) => r.state).join() === "excluded,included,excluded" && rows[1].pinned, "overrides add and remove entries");
rows = explainCodex(entries, "Mira walked.", 5);
ok(rows.some((r) => r.state === "too-long"), "entries over the budget are flagged");
const block = buildCodexBlock(entries, "Mira walked.", 1000, { include: ["b"], exclude: ["a"] });
ok(block.includes("Zed [character]") && block.includes("Rule [character]") && !block.includes("Mira [character]"), "the prompt block follows the overrides");
ok(buildCodexBlock(entries, "Mira walked.", 1000) === buildCodexBlock(entries, "Mira walked.", 1000, { include: [], exclude: [] }), "no overrides changes nothing");

// ---- ideas for a new branch ----
const ideas = parseIdeas('Sure! [{"choice":" Follow the stranger ","direction":"Mira trails him."},{"choice":"","direction":"x"},{"direction":"no choice"},{"choice":"Wait"}]');
ok(ideas.length === 2 && ideas[0].choice === "Follow the stranger" && ideas[0].direction === "Mira trails him." && ideas[1].direction === "", "parseIdeas keeps usable ideas and trims them");
ok(parseIdeas("nothing").length === 0 && parseIdeas("[oops").length === 0, "parseIdeas copes with junk");
const ip = ideasPrompt({ storyTitle: "T", premise: "P", path: [ch(1)], choiceLabel: null, siblingChoices: ["Open it", "Run"] }, 8000);
ok(ip.includes('"Open it", "Run"') && ip.includes("Suggest 4 distinct directions") && ip.includes("Premise: P"), "ideasPrompt lists existing choices and the story");
const after = ideasPrompt({ storyTitle: "T", premise: "P", path: [ch(1)], choiceLabel: "Climb the tower", siblingChoices: ["Open it"] }, 8000);
ok(after.includes('The reader chose: "Climb the tower"') && after.includes("following from the reader's choice") && !after.includes('"Open it"'), "ideasPrompt follows the choice text when there is one");
const guided = ideasPrompt({ storyTitle: "T", premise: "P", path: [ch(1)], choiceLabel: null }, 8000, "cats attack him, he fights back");
ok(guided.includes('"cats attack him, he fights back"') && guided.includes("not just what follows from it"), "ideasPrompt makes the guidance part of each idea");
const opening = ideasPrompt({ storyTitle: "T", premise: "P", path: [], choiceLabel: null }, 8000);
ok(opening.includes("ways this story could open"), "ideasPrompt suggests openings for a new story");

// ---- tiers: verbatim, then per-chapter summaries, then the rolling summary ----
const tiered = Array.from({ length: 30 }, (_, i) => ch(i + 1, { summary: `SUMMARY-${i + 1} ${"word ".repeat(40)}`, path_summary: `ROLLING-${i + 1}` }));
s = buildStorySoFar(tiered, 1000);
const listedNums = [...s.matchAll(/- Ch(\d+): SUMMARY-/g)].map((m) => Number(m[1]));
const rollingAt = Number(/Earlier in the story:\nROLLING-(\d+)/.exec(s)?.[1]);
ok(s.includes("### Ch30") && listedNums.length > 3 && rollingAt > 0, `long story uses all three tiers (rolling through ${rollingAt}, listed ${listedNums[0]}–${listedNums.at(-1)})`);
ok(listedNums[0] === rollingAt + 1 && listedNums.every((n, i) => n === listedNums[0] + i) && !s.includes("SUMMARY-30"), "no gaps or overlaps between the tiers");
ok(estimateTokens(s) <= 1100, "stays near budget: " + estimateTokens(s));
s = buildStorySoFar(tiered.slice(0, 6), 1000);
ok(!s.includes("ROLLING-") && s.includes("Earlier in the story, chapter by chapter:\n- Ch1: SUMMARY-1"), "per-chapter summaries alone when they all fit");
// a missing rolling summary at the boundary: the next one inside the listed range is used instead
const gap = tiered.map((c, i) => (i === rollingAt - 1 ? { ...c, path_summary: null } : c));
s = buildStorySoFar(gap, 1000);
ok(s.includes(`Earlier in the story:\nROLLING-${rollingAt + 1}`) && !s.includes(`- Ch${rollingAt + 1}:`) && s.includes(`- Ch${rollingAt + 2}:`), "falls forward to the nearest rolling summary without leaving a gap");
ok(parseChoiceLabel('"Follow the stranger inside."\nExtra') === "Follow the stranger inside", "choice label: first line, quotes and full stop removed");
ok(parseChoiceLabel("- Run away") === "Run away" && parseChoiceLabel("") === "", "choice label: bullets and empty replies");
ok(parseChoiceLabel("Follow the stranger. Then run away.") === "Follow the stranger", "choice label: only the first sentence");
