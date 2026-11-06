// Importing a story from text: cutting it into paragraphs, reading the AI's breaks, the fallback split, and the checks
// on a plan before it becomes a story.
import {
  chapterBody, chapterRanges, countWords, fallbackSplit, mergeShort, parseDetails, parseSplit, parseStoryText, planProblems, rangeWords, splitPrompt,
  windowEnd, type ImportPlan,
} from "../../src/lib/textImport.ts";
const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- paragraphs ----
let t = parseStoryText("﻿# The Salt Road\r\n\r\nThe caravan left at dawn.\r\nIlsa rode at the back.\r\n\r\n***\r\n\r\nBy the third day the wells tasted of iron.\n\n## Lights\n\nThe lights came on.\n\n\n\nShe pulled her boots on.");
ok(t.title === "The Salt Road", "a level-1 heading before the text is the story's title");
ok(t.paragraphs.length === 4, "blank lines split paragraphs; headings and scene breaks are not paragraphs: " + t.paragraphs.length);
ok(t.paragraphs[0] === "The caravan left at dawn.\nIlsa rode at the back.", "a paragraph keeps its own line breaks, word for word");
ok(JSON.stringify(t.breaks) === "[1,2]", "a scene break and a heading mark where a chapter could start: " + JSON.stringify(t.breaks));
ok(t.headings[2] === "Lights" && t.headings[1] === undefined, "a heading is the title of the chapter starting there");
t = parseStoryText("One line.\nTwo line.\nThree line.\nFour line.\nFive line.");
ok(t.paragraphs.length === 5 && t.title === null, "a text with no blank lines at all is split at every line");
t = parseStoryText("Just one paragraph\nwith a wrapped line.");
ok(t.paragraphs.length === 1, "a short text with a wrapped line stays one paragraph");
ok(parseStoryText("   \n\n  ").paragraphs.length === 0, "nothing but spaces has no paragraphs");
t = parseStoryText("## Part one\nIt began.\n\nIt went on.");
ok(t.title === null && t.paragraphs[0] === "It began." && t.headings[0] === "Part one", "a heading with text under it in the same block");

// ---- windows and the prompt ----
const P = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1} ${"word ".repeat(48).trim()}`); // 50 words each
ok(countWords(P[0]) === 50, "word count");
ok(windowEnd(P, 0, 220) === 4 && windowEnd(P, 4, 100000) === 20, "a window holds whole paragraphs up to its words");
ok(windowEnd(P, 0, 10) === 1, "…and at least one");
const prompt = splitPrompt({ paragraphs: P, from: 4, to: 12, minWords: 100, maxWords: 200, breaks: [6, 15], last: false });
ok(prompt.includes("[5] (50 words) Paragraph 5") && prompt.includes("[12] ") && !prompt.includes("[13] ") && !prompt.includes("[4] "), "the prompt numbers the window's paragraphs for the whole story");
ok(prompt.includes("before paragraphs 7;") || prompt.includes("before paragraphs 7 "), "…names the marked breaks inside it");
ok(prompt.includes("may end before it"), "…and says when the text stops mid-story");

// ---- reading the breaks ----
let got = parseSplit('Here: ```json\n[{"end": 6, "title": "Dust", "choice": "Ask Dace."}, {"end": 3, "title": "x"}, {"end": 9, "title": "Lights", "choice": "\\"Slip away\\""}, {"end": 40}]\n```', 4, 12);
ok(JSON.stringify(got) === JSON.stringify([{ end: 6, title: "Dust", choice: "Ask Dace" }, { end: 9, title: "Lights", choice: "Slip away" }]), "breaks outside the window or out of order are dropped; quotes and full stops trimmed: " + JSON.stringify(got));
ok(parseSplit("I can't do that", 0, 10) === null && parseSplit("[]", 0, 10) === null && parseSplit("[1, 2", 0, 10) === null, "a reply with nothing to read is null");

// ---- the fallback and short chapters ----
const ends = fallbackSplit(P, 0, 20, 100, 200, [5]);
ok(ends[ends.length - 1] === 20 && ends.every((e, i) => i === 0 || e > ends[i - 1]), "the fallback ends at the end, in order: " + JSON.stringify(ends));
ok(ends[0] === 3 && ends[1] === 5, "…about the middle length, or at a marked break once long enough: " + JSON.stringify(ends));
const merged = mergeShort(P, [{ end: 1, title: "A", choice: "a" }, { end: 6, title: "", choice: "b" }, { end: 19, title: "C", choice: "c" }, { end: 20, title: "D", choice: "" }], 0, 200);
ok(JSON.stringify(merged.map((e) => e.end)) === "[6,20]", "a far too short chapter joins the next; a short last one joins the one before: " + JSON.stringify(merged));
ok(merged[0].title === "A" && merged[0].choice === "b" && merged[1].choice === "", "…keeping the later chapter's choice and the earlier title when it has none");

// ---- chapters from a plan ----
const plan: ImportPlan = {
  title: "The Salt Road",
  premise: "",
  style: "",
  chapters: [
    { start: 0, title: "One", choice: "Go on", alternatives: [{ label: "Turn back", keep: true }] },
    { start: 8, title: "Two", choice: "", alternatives: [{ label: "Another ending", keep: false }] },
  ],
};
const ranges = chapterRanges(plan.chapters, 20);
ok(JSON.stringify(ranges) === JSON.stringify([{ start: 0, end: 8 }, { start: 8, end: 20 }]), "ranges run to the next chapter's start");
ok(rangeWords(P, ranges[0]) === 400 && chapterBody(P, ranges[1]).split("\n\n").length === 12, "a chapter's words and body");
ok(planProblems(plan, 20).length === 0, "a good plan has no problems");
const bad: ImportPlan = { ...plan, title: " ", chapters: [{ ...plan.chapters[0], start: 1, choice: "" }, { ...plan.chapters[1], start: 1, title: "" }] };
const problems = planProblems(bad, 20);
ok(problems.includes("The story needs a title.") && problems.some((p) => p.startsWith("The first chapter")) && problems.includes("Chapter 1 has no paragraphs.") && problems.includes("Chapter 1 needs the choice that leads to chapter 2.") && problems.includes("Chapter 2 needs a title."), "a bad plan says what is wrong: " + JSON.stringify(problems));
const many: ImportPlan = { ...plan, chapters: [{ ...plan.chapters[0], alternatives: Array.from({ length: 12 }, (_, i) => ({ label: `c${i}`, keep: true })) }, plan.chapters[1]] };
ok(planProblems(many, 20).includes("Chapter 1 has more than 12 choices."), "…including too many choices");

// ---- the story's details ----
ok(JSON.stringify(parseDetails('Sure! {"title": " Road ", "premise": "A girl.", "style": "Dry."}')) === JSON.stringify({ title: "Road", premise: "A girl.", style: "Dry." }), "details are read from the reply");
ok(JSON.stringify(parseDetails("no json")) === JSON.stringify({ title: "", premise: "", style: "" }), "…or left empty");
