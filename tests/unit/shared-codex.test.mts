import { foldCodex, mergeOverrides, resolveShared, retiredEntries, sharedFactOps, type CodexOp, type FactOp, type SharedBase } from "../../src/lib/codex.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

let n = 0;
const op = (over: Partial<CodexOp>): CodexOp => ({
  id: `o${n++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mara", op: "create", name: "Mara", type: "character",
  aliases: [], content: "snapshot", always_include: false, posted_at: 1000 + n, shared_entry_id: "S", ...over,
});
const fop = (over: Partial<FactOp>): FactOp => ({
  id: `f${n++}`, anchor_chapter_id: "c0", anchor_depth: 0, entry_id: "mara", fact_id: "ears", op: "set", aspect: "Ears",
  form: "", text: "Round ears.", quote: "", posted_at: 1000 + n, ...over,
});
const base = (over: Partial<SharedBase> = {}): SharedBase => ({
  id: "S", name: "Mara", type: "character", aliases: ["Mar"], content: "Base notes.", always_include: false,
  facts: [{ id: "ears", aspect: "Ears", form: "", text: "Round ears." }, { id: "eyes", aspect: "Eyes", form: "", text: "Green." }], ...over,
});
const bases = (b: SharedBase) => new Map([[b.id, b]]);
const fold = (ops: CodexOp[], facts: FactOp[], b: SharedBase) => foldCodex(resolveShared(ops, bases(b)), [...sharedFactOps(ops, bases(b)), ...facts]);

// A link reads the base, not the snapshot stored with the op
let es = fold([op({})], [], base());
ok(es.length === 1 && es[0].name === "Mara" && es[0].content === "Base notes." && es[0].aliases.join() === "Mar", "a linked entry reads the base's fields");
ok(es[0].shared_entry_id === "S" && es[0].overridden.length === 0, "…and says it is shared, with nothing changed");
ok(es[0].description === "Ears: Round ears. Eyes: Green.", "…and the base's facts: " + es[0].description);

// Editing the base reaches the entry
es = fold([op({})], [], base({ name: "Mara Vale", content: "New notes.", facts: [{ id: "ears", aspect: "Ears", form: "", text: "Tall ears." }] }));
ok(es[0].name === "Mara Vale" && es[0].content === "New notes." && es[0].description === "Ears: Tall ears.", "a change to the base shows in the story");

// Story overrides: fields
const ov = [op({}), op({ op: "replace", anchor_chapter_id: "c2", anchor_depth: 2, overrides: { content: "My notes.", aliases_add: ["Mari"], aliases_remove: ["Mar"] } })];
es = fold(ov, [], base());
ok(es[0].content === "My notes." && es[0].aliases.join() === "Mari" && es[0].overridden.join() === "content,aliases", "a story override changes its fields: " + es[0].overridden.join());
es = fold(ov, [], base({ content: "Newer base notes.", aliases: ["Mar", "Mara-lee"] }));
ok(es[0].content === "My notes." && es[0].aliases.join() === "Mara-lee,Mari", "…and keeps winning over later base edits; other keywords follow the base: " + es[0].aliases.join());
es = fold(ov.slice(0, 1), [], base());
ok(es[0].content === "Base notes." && es[0].overridden.length === 0, "…but not in a chapter above the override");

// Overrides accumulate along the path, and a later replace without them keeps them (as when an entry is kept in a chapter)
es = fold([...ov, op({ op: "replace", anchor_chapter_id: "c3", anchor_depth: 3, overrides: { type: "item" } })], [], base());
ok(es[0].content === "My notes." && es[0].type === "item", "overrides add up along the path");
es = fold([...ov, op({ op: "replace", anchor_chapter_id: "c3", anchor_depth: 3, overrides: null })], [], base());
ok(es[0].content === "My notes.", "a replace with no overrides keeps them");
es = fold([...ov, op({ op: "create", entry_id: "mara", anchor_chapter_id: "c3", anchor_depth: 3 })], [], base());
ok(es[0].content === "Base notes.", "a create starts again from the base");

// Retire and revive
const gone = [op({}), op({ op: "retire", anchor_chapter_id: "c1", anchor_depth: 1 })];
ok(fold(gone, [], base()).length === 0 && retiredEntries(resolveShared(gone, bases(base())))[0]?.name === "Mara", "a linked entry can be retired, and is listed with the base's name");

// Facts: a story's fact on a base fact's id changes it, or hides it, for that story only
es = fold([op({})], [fop({ anchor_chapter_id: "c2", anchor_depth: 2, text: "Fox ears." })], base());
ok(es[0].description === "Ears: Fox ears. Eyes: Green.", "a story's fact on a base fact's id replaces it: " + es[0].description);
es = fold([op({})], [fop({ anchor_chapter_id: "c2", anchor_depth: 2, op: "retire", fact_id: "eyes" })], base());
ok(es[0].description === "Ears: Round ears.", "…or hides it");
es = fold([op({})], [fop({ fact_id: "own", aspect: "Tail", text: "A fox tail." })], base());
ok(es[0].description === "Ears: Round ears. Eyes: Green. Tail: A fox tail.", "a story can add facts of its own: " + es[0].description);
es = fold([op({})], [fop({ anchor_chapter_id: "c2", anchor_depth: 2, text: "Fox ears." })], base({ facts: [{ id: "ears", aspect: "Ears", form: "", text: "Base change." }] }));
ok(es[0].description === "Ears: Fox ears.", "the story's fact still wins after the base fact changes");
es = fold([op({})], [], base({ facts: [{ id: "form", aspect: "form", form: "vixen", text: "" }, { id: "tail", aspect: "Tail", form: "vixen", text: "Bushy." }] }));
ok(es[0].form?.name === "vixen" && es[0].description === "Form: vixen. Tail: Bushy.", "the base can hold a form: " + es[0].description);

// Facts are set at the chapter where the entry was linked, and only for linked entries
const injected = sharedFactOps([op({ anchor_chapter_id: "c4", anchor_depth: 4 }), op({ entry_id: "own", shared_entry_id: null })], bases(base()));
ok(injected.length === 2 && injected.every((f) => f.anchor_chapter_id === "c4" && f.anchor_depth === 4 && f.entry_id === "mara"), "base facts are anchored at the link chapter");
ok(foldCodex([op({ entry_id: "plain", shared_entry_id: null })]).length === 1 && resolveShared([op({ shared_entry_id: null })], bases(base())).length === 1, "entries that aren't linked are left alone");
const orphan = [op({})];
ok(resolveShared(orphan, new Map()) === orphan, "a link whose base is gone keeps the snapshot");

// Merging overrides
const m = mergeOverrides({ content: "a", aliases_add: ["X"], aliases_remove: ["Y"] }, { content: "b", aliases_add: ["Y"], aliases_remove: ["X"] });
ok(m.content === "b" && m.aliases_add?.join() === "Y" && m.aliases_remove?.join() === "X", "later keyword changes undo earlier ones: " + JSON.stringify(m));
