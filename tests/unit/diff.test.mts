import { diffWords } from "../../src/lib/diff.ts";
import { passageRefinePrompt } from "../../src/lib/ai/prompts.ts";
const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const show = (parts: ReturnType<typeof diffWords>) => parts.map((p) => (p.type === "same" ? p.text : p.type === "add" ? `+{${p.text}}` : `-{${p.text}}`)).join("");

ok(show(diffWords("same text", "same text")) === "same text", "identical text has no changes");
ok(show(diffWords("The cat sat down.", "The dog sat down.")) === "The -{cat}+{dog} sat down.", "one word swapped: " + show(diffWords("The cat sat down.", "The dog sat down.")));
ok(show(diffWords("a b c", "a c")) === "a -{b }c", "a removed word: " + show(diffWords("a b c", "a c")));
ok(show(diffWords("a c", "a b c")) === "a +{b }c", "an added word: " + show(diffWords("a c", "a b c")));
ok(show(diffWords("", "new")) === "+{new}" && show(diffWords("old", "")) === "-{old}", "from or to nothing");
const a = "Mira walked to the river. The mist was thick. She heard a bell.";
const b = "Mira ran to the river. The mist was thin and cold. She heard a distant bell ring.";
const parts = diffWords(a, b);
ok(parts.filter((p) => p.type !== "add").map((p) => p.text).join("") === a, "the old text is the unchanged plus removed parts");
ok(parts.filter((p) => p.type !== "del").map((p) => p.text).join("") === b, "the new text is the unchanged plus added parts");
const big = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ");
const other = Array.from({ length: 3000 }, (_, i) => `v${i}`).join(" ");
const t0 = Date.now();
const huge = diffWords(big, other);
ok(huge.map((p) => p.text).join("").length > 0 && Date.now() - t0 < 3000, "completely different long texts stay fast");

const p = passageRefinePrompt({ storyTitle: "T", premise: "P", path: [], choiceLabel: null }, { title: "Door", before: "One. ", passage: "Two.", after: " Three." }, "tenser", 8000);
ok(p.includes("One. [[START]]Two.[[END]] Three.") && p.includes("tenser"), "passage prompt marks the passage");
