import { noteText, rollUpNotes } from "../../src/lib/contentNotesRoll.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// root -> a -> a1 -> a2, root -> b; parents come before children.
const chapters = [
  { id: "root", parent_id: null },
  { id: "a", parent_id: "root" },
  { id: "b", parent_id: "root" },
  { id: "a1", parent_id: "a" },
  { id: "a2", parent_id: "a1" },
];
const own = new Map([
  ["a", [{ name: "violence", value: "mild" }, { name: "tf", value: null }]],
  ["a1", [{ name: "Violence", value: "graphic" }, { name: "tg", value: null }]],
  ["a2", [{ name: "TG", value: null }, { name: "alpha", value: null }, { name: "violence", value: "mild" }]],
]);
const notes = rollUpNotes(chapters, own);

ok(JSON.stringify(notes.get("a")) === JSON.stringify({ next: ["tf", "violence (mild)"], later: ["alpha", "tg"] }), "next is the chapter's own tags, sorted; later leaves out those already in next: " + JSON.stringify(notes.get("a")));
ok(JSON.stringify(notes.get("a1")) === JSON.stringify({ next: ["tg", "Violence (graphic)"], later: ["alpha"] }), "a tag with several values is listed once: " + JSON.stringify(notes.get("a1")));
ok(JSON.stringify(notes.get("a2")) === JSON.stringify({ next: ["alpha", "TG", "violence (mild)"], later: [] }), "a leaf has nothing later");
ok(JSON.stringify(notes.get("b")) === JSON.stringify({ next: [], later: [] }), "a chapter with no tags below has no notes");
ok(JSON.stringify(notes.get("root")) === JSON.stringify({ next: [], later: ["alpha", "tf", "tg", "violence (mild, graphic)"] }), "the root rolls up the whole branch with values joined, case-insensitively: " + JSON.stringify(notes.get("root")));

ok(noteText(notes.get("a")) === "Next: tf, violence (mild) · Later on this branch: alpha, tg", "both parts are joined with a dot");
ok(noteText(notes.get("a2")) === "Next: alpha, TG, violence (mild)", "an empty part is left out");
ok(noteText({ next: [], later: ["x"] }) === "Later on this branch: x", "later alone");
ok(noteText(notes.get("b")) === null && noteText(undefined) === null, "no note when both are empty");
