import {
  DEFAULT_CATEGORIES,
  aspectRules,
  categoriesFromText,
  categoriesToText,
  isKnownAspect,
  resolveAspect,
} from "../../src/lib/codexCategories.ts";
import { ENTRY_TYPES, describeEntry, foldCodex, goneFacts, type CodexOp, type FactOp } from "../../src/lib/codex.ts";
import { parseCodexCheck } from "../../src/lib/ai/codexCheckAi.ts";
import { parseSettings } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const chars = DEFAULT_CATEGORIES.character;

// The default lists: no name used twice within a type, and no other name that is also a category's name or another's other name.
for (const t of ENTRY_TYPES) {
  const names = DEFAULT_CATEGORIES[t].flatMap((x) => [x.name, ...x.also].map((s) => s.toLowerCase()));
  ok(new Set(names).size === names.length, `${t}: every category and other name is distinct`);
}
ok(chars.some((x) => x.name === "Teeth") && chars.some((x) => x.name === "Sexual Characteristics"), "Teeth and Sexual Characteristics are on the character list");

// Resolving an aspect the AI wrote.
ok(resolveAspect("Personality", chars).aspect === "Personality" && resolveAspect("Personality", chars).known, "a listed name is kept");
ok(resolveAspect("temperament", chars).aspect === "Personality", "another name is filed under its category");
ok(resolveAspect("Fur", chars).aspect === "Skin", "Fur is filed under Skin");
ok(resolveAspect("Fur", chars, [{ aspect: "Fur" }]).aspect === "Fur", "the entry's own aspect is kept as it is");
ok(resolveAspect("Scales", chars, [{ aspect: "Fur" }]).aspect === "Fur", "an aspect in the same category as one on the entry takes the entry's spelling");
ok(resolveAspect("Condition", chars, [{ aspect: "Status" }]).aspect === "Status", "an old Status fact is reused for Condition");
const gills = resolveAspect("New: Gills", chars);
ok(gills.aspect === "Gills" && !gills.known, "“New: Gills” is a new category");
ok(!isKnownAspect("Gills", chars) && isKnownAspect("Gills", chars, [{ aspect: "gills" }]), "a new category becomes known once the entry has it");
ok(resolveAspect("", chars).known && resolveAspect("form", chars).aspect === "form", "a loose fact and the form aspect pass through");

// The text box in Settings.
const round = categoriesFromText(categoriesToText(chars));
ok(JSON.stringify(round) === JSON.stringify(chars), "the character list survives the text box unchanged");
const typed = categoriesFromText("# Body\nGills: Breathing slits. (also: gill slits)\n\nGills: duplicate\nfins\nform: not allowed");
ok(typed.length === 2 && typed[0].group === "Body" && typed[0].also[0] === "gill slits" && typed[1].name === "fins" && typed[1].about === "", "typed lines: headings, other names, duplicates and the form aspect");

// Settings: missing lists get the defaults; a saved list is kept.
ok(JSON.stringify(parseSettings({}).codexCategories) === JSON.stringify(DEFAULT_CATEGORIES), "settings without lists get the defaults");
const custom = parseSettings({ codexCategories: { character: [{ name: "Gills", about: "", also: [], group: "" }] } }).codexCategories;
ok(custom.character.length === 1 && custom.place.length === DEFAULT_CATEGORIES.place.length, "a saved list is kept and the missing ones get the defaults");

// The prompt rules.
const rules = aspectRules(DEFAULT_CATEGORIES, ["character"]);
ok(rules.includes("- Sexual Characteristics:") && rules.includes('"New: <Name>"') && rules.includes("Tail: none") && !rules.includes("Aspects for a place"), "the rules list the type's categories, new categories and the no-“none” rule");

// The codex check files the AI's aspects.
let n = 0;
const op = (entry_id: string, name: string): CodexOp => ({ id: `o${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id, op: "create", name, type: "character", aliases: [], content: "", always_include: false, posted_at: n });
const fact = (fact_id: string, aspect: string, form: string, text: string, extra: Partial<FactOp> = {}): FactOp => ({ id: `f${++n}`, anchor_chapter_id: "c1", anchor_depth: 0, entry_id: "mira", fact_id, op: "set", aspect, form, text, quote: "", posted_at: n, ...extra });
const entries = foldCodex([op("mira", "Mira")], [fact("f-fur", "Fur", "", "Russet fur.")]);
const body = "Mira's fur had turned to green scales. Her temper was short. She had grown gills.";
const reply = JSON.stringify({
  changes: [
    { kind: "set", entry: "Mira", aspect: "Scales", text: "Green scales.", quote: "Mira's fur had turned to green scales." },
    { kind: "set", entry: "Mira", aspect: "Skin", text: "Scaly green skin.", quote: "Mira's fur had turned to green scales." },
    { kind: "set", entry: "Mira", aspect: "Temperament", text: "Short-tempered.", quote: "Her temper was short." },
    { kind: "set", entry: "Mira", aspect: "New: Gills", text: "Gills on her neck.", quote: "She had grown gills." },
  ],
});
const found = parseCodexCheck(reply, { body, entries, otherNames: [] });
ok(found.length === 3, "a second change to the same fact in one reply is dropped");
ok(found[0].aspect === "Fur" && found[0].after === "Green scales.", "Scales changes the entry's Fur fact");
ok(found[1].aspect === "Personality", "Temperament is filed under Personality");
ok(found[2].aspect === "Gills", "“New: Gills” loses its prefix");

// A removed feature is named once, in the chapter where it goes.
const tailOps = [fact("f-tail", "Tail", "", "A bushy tail."), fact("f-tail", "Tail", "", "", { op: "retire", anchor_chapter_id: "c2", anchor_depth: 1 })];
ok(goneFacts(tailOps, "c2").get("mira")?.[0]?.aspect === "Tail", "a fact removed at the chapter is gone there");
ok(!goneFacts(tailOps, "c3").has("mira"), "and not at a later chapter");
const at2 = foldCodex([op("mira", "Mira")], tailOps, { recentAnchor: "c2" })[0];
const at3 = foldCodex([op("mira", "Mira")], tailOps, { recentAnchor: "c3" })[0];
ok(at2.description.includes("Tail: gone (just changed)."), "the AI is told the tail just went");
ok(!at3.description.includes("Tail"), "after that the tail isn't mentioned at all");
ok(describeEntry([], undefined, null, [{ aspect: "Wings", form: "dragon" }]) === "", "a fact gone from another form isn't mentioned");
