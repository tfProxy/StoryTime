import { parseTidy, tidyOps, tidyRequest } from "../../src/lib/ai/tidyAi.ts";
import { foldCodex, type CodexOp, type FactOp } from "../../src/lib/codex.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

let n = 0;
const op: CodexOp = { id: "o1", anchor_chapter_id: "c1", anchor_depth: 0, entry_id: "s", op: "create", name: "Sylvia", type: "character", aliases: [], content: "", always_include: false, posted_at: 0 };
const fact = (fact_id: string, aspect: string, form: string, text: string, anchor = "c1"): FactOp => ({ id: `f${++n}`, anchor_chapter_id: anchor, anchor_depth: 0, entry_id: "s", fact_id, op: "set", aspect, form, text, quote: "", posted_at: n });
const [entry] = foldCodex([op], [
  fact("f-form", "form", "Lizard Woman", ""),
  fact("a", "Fur", "", "Russet fur."), // 1
  fact("b", "Personality", "", "Cheerful."), // 2
  fact("c", "Temperament", "", "Quick to anger.", "c2"), // 3
  fact("d", "Tail", "", "None."), // 4
  fact("e", "Eyes and Teeth", "Lizard Woman", "Gold slit eyes and sharp teeth."), // 5
]);

const req = tidyRequest(entry);
ok(req.message.includes("1. Fur [every form]: Russet fur.") && req.message.includes("5. Eyes and Teeth [Lizard Woman form]") && !req.message.includes("form [every form]"), "the facts are numbered with their forms, the form left out");
ok(req.message.includes("- Sexual Characteristics (can differ by form):") && req.message.includes("Its forms: Lizard Woman"), "the list and the forms are given");

const reply = JSON.stringify({
  changes: [
    { from: [1], aspect: "Skin", form: "", text: "Russet fur.", why: "Fur is filed under Skin" },
    { from: [2, 3], aspect: "Temperament", form: "", text: "Cheerful but quick to anger.", why: "Same aspect" },
    { from: [4], aspect: "Tail", form: "", text: "", why: "A none fact" },
    { from: [5], aspect: "Eyes", form: "Lizard Woman form", text: "Gold slit eyes.", why: "Split" },
    { from: [5], aspect: "Teeth", form: "Lizard Woman", text: "Sharp teeth.", why: "Split" },
    { from: [2], aspect: "Personality", form: "", text: "Cheerful.", why: "no change" },
    { from: [9], aspect: "Ears", text: "x" },
    { from: [1], aspect: "Skin", form: "dragon", text: "x" },
    { from: [1], aspect: "Gills", form: "", text: "Russet fur.", why: "odd" },
  ],
});
const changes = parseTidy(reply, entry);
ok(changes.length === 6, `bad numbers, unknown forms and no-op changes are dropped (${changes.length})`);
ok(changes[0].aspect === "Skin" && changes[1].aspect === "Personality", "aspects are filed under the list (Temperament → Personality)");
ok(changes[3].form === "Lizard Woman" && changes[4].form === "Lizard Woman", "forms are cleaned to the entry's spelling");
ok(changes[5].newCategory && !changes[0].newCategory, "an aspect not on the list is flagged");

const ops = tidyOps(entry, changes.slice(0, 5));
const sets = ops.filter((o) => o.op === "set");
const retires = ops.filter((o) => o.op === "retire");
ok(sets[0].fact_id === "a" && sets[0].aspect === "Skin" && sets[0].anchor === "c1", "a rename keeps the fact, as a correction where it was set");
ok(sets[1].fact_id === "b" && sets[1].text === "Cheerful but quick to anger.", "a merge keeps the first fact");
ok(sets[2].fact_id === "e" && sets[2].aspect === "Eyes" && sets[3].fact_id === undefined && sets[3].aspect === "Teeth" && sets[3].anchor === "c1", "a split keeps the fact for its first part and adds the others where it was set");
ok(retires.map((r) => r.fact_id).sort().join() === "c,d" && retires.find((r) => r.fact_id === "c")!.anchor === "c2", "merged and removed facts are retired where they were set");
ok(ops.findLastIndex((o) => o.op === "retire") < ops.findIndex((o) => o.op === "set"), "removals come before sets");
ok(tidyOps(entry, [changes[1]]).filter((o) => o.op === "retire").length === 1, "only the chosen changes are written");
ok(parseTidy('{"changes":[]}', entry).length === 0, "nothing to tidy");

// One fact per aspect, whatever the AI proposed.
const [place] = foldCodex([{ ...op, entry_id: "p", name: "The Hatching Ground", type: "place" }], [
  { ...fact("g1", "Look", "", "Hard, rough ground."), entry_id: "p" },
  { ...fact("g2", "Lighting", "", "Dim and dark"), entry_id: "p" },
]);
const both = parseTidy(JSON.stringify({ changes: [{ from: [1], aspect: "Appearance", text: "Hard, rough ground.", why: "Look is Appearance" }, { from: [2], aspect: "Appearance", text: "Dim and dark", why: "Lighting" }] }), place);
ok(both.length === 1 && both[0].sources.join() === "g1,g2" && both[0].text === "Hard, rough ground. Dim and dark", "two changes onto one aspect are merged into one");
const [place2] = foldCodex([{ ...op, entry_id: "p", name: "The Hatching Ground", type: "place" }], [
  { ...fact("g1", "Appearance", "", "Hard, rough ground."), entry_id: "p" },
  { ...fact("g2", "Lighting", "", "Dim and dark"), entry_id: "p" },
]);
const onto = parseTidy(JSON.stringify({ changes: [{ from: [2], aspect: "Appearance", text: "Dim and dark", why: "x" }] }), place2);
ok(onto.length === 1 && onto[0].sources.join() === "g1,g2" && onto[0].text.startsWith("Hard, rough ground."), "a change onto a fact left alone takes it in, the fact first");
ok(parseTidy(JSON.stringify({ changes: [{ from: [2], aspect: "Atmosphere", text: "Dim and dark", why: "Light is atmosphere" }] }), place)[0].aspect === "Atmosphere", "lighting goes under Atmosphere");

// Aspects that are the same in every form lose their form.
const [lizard] = foldCodex([op], [
  fact("f-form", "form", "Lizard Woman", ""),
  fact("p1", "Personality", "", "Cheerful."),
  fact("p2", "Personality", "Lizard Woman", "Quick to anger."),
  fact("r1", "Relationships", "Lizard Woman", "Friends with Tomas."),
  fact("k1", "Skin", "Lizard Woman", "Green scales."),
]);
const forms = parseTidy('{"changes":[]}', lizard);
const pers = forms.find((c) => c.aspect === "Personality");
const rel = forms.find((c) => c.aspect === "Relationships");
ok(!!pers && pers.form === "" && pers.sources.join() === "p1,p2" && pers.text === "Cheerful. Quick to anger.", "a form-only Personality is merged into the every-form one");
ok(!!rel && rel.form === "" && rel.sources.join() === "r1", "a form-only Relationships moves to every form");
ok(!forms.some((c) => c.aspect === "Skin"), "Skin can differ by form and is left alone");
const relOps = tidyOps(lizard, [rel!]);
ok(relOps.length === 1 && relOps[0].op === "set" && relOps[0].fact_id === "r1" && relOps[0].form === "", "moving to every form keeps the fact");
