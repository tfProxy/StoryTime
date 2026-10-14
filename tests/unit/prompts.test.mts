import { buildStorySoFar, parseChapterOutput, parseChoices, generatePrompt, estimateTokens, explainCodex, buildCodexBlock, ideasPrompt, parseIdeas } from "../../src/lib/ai/prompts.ts";
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
