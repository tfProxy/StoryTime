import { middleBreak, splitParagraphs } from "../../src/lib/imageSlots.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const para = (n: number) => "x".repeat(n);

ok(middleBreak([]) === 0, "no paragraphs: 0");
ok(middleBreak([para(50)]) === 1, "one paragraph: the picture comes after it");
ok(middleBreak([para(10), para(10)]) === 1, "two equal paragraphs: between them");
ok(middleBreak([para(10), para(10), para(10), para(10)]) === 2, "even paragraphs: the centre break");
ok(middleBreak([para(10), para(10), para(10)]) === 1, "a tie goes to the earlier break");
ok(middleBreak([para(1000), para(10), para(10)]) === 1, "one huge first paragraph: break after it");
ok(middleBreak([para(10), para(10), para(1000)]) === 2, "one huge last paragraph: break before it");
ok(middleBreak([para(10), para(30), para(10), para(10), para(10)]) === 2, "the break nearest half the characters");
ok(JSON.stringify(splitParagraphs("a\n\n \n\nb\n  \nc\n").map((p) => p.trim())) === JSON.stringify(["a", "b", "c"]), "paragraphs split on blank lines, without empty ones");
