import { wordDiff } from "../../src/lib/wordDiff.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const join = (s: ReturnType<typeof wordDiff>, t: string) => s.filter((x) => x.type === t).map((x) => x.text).join("|");
const text = (s: ReturnType<typeof wordDiff>, keep: string[]) => s.filter((x) => keep.includes(x.type)).map((x) => x.text).join("");

{
  const d = wordDiff("Mira has green eyes.", "Mira has grey eyes.");
  ok(join(d, "del").trim() === "green", "a replaced word is deleted");
  ok(join(d, "add").trim() === "grey", "and added");
  ok(text(d, ["same", "add"]) === "Mira has grey eyes.", "same + add rebuilds the new text exactly");
  ok(text(d, ["same", "del"]) === "Mira has green eyes.", "same + del rebuilds the old text exactly");
}
{
  const d = wordDiff("", "A new fact.");
  ok(d.length === 1 && d[0].type === "add" && d[0].text === "A new fact.", "an empty before is all added");
}
{
  const d = wordDiff("An old fact.", "");
  ok(d.length === 1 && d[0].type === "del" && d[0].text === "An old fact.", "an empty after is all deleted");
}
{
  const d = wordDiff("Same words here", "Same words here");
  ok(d.length === 1 && d[0].type === "same", "equal texts are one same segment");
}
{
  const d = wordDiff("He is dead.", "He is dead");
  ok(join(d, "del").trim() === "dead." && join(d, "add").trim() === "dead", "punctuation is part of the word");
}
{
  const before = "Lives in the tower  with her cat";
  const after = "Lives in the old tower with her dog and cat";
  const d = wordDiff(before, after);
  ok(text(d, ["same", "add"]).replace(/\s+/g, " ") === after.replace(/\s+/g, " "), "inserting words keeps the rest in order");
  ok(join(d, "add").includes("old") && join(d, "add").includes("dog"), "both insertions are shown");
}
ok(wordDiff("", "").length === 0, "nothing in, nothing out");
