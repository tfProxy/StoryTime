import { emptyDraft } from "../../src/lib/drafts.ts";
import { applyAfterGenerate, applyGenerated, beginGenerated, MAX_UNDO, MAX_VERSIONS, pushUndo, startVersion } from "../../src/lib/generatedDraft.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const draft = (extra = {}) => ({ ...emptyDraft("fill:c1", "/c/p/write?choice=c1", "Story: “Go”"), ...extra });

// A draft with text: the text is kept as the previous version and in undo.
const written = draft({ title: "Mine", body: "My own words." });
const a = applyGenerated(written, { title: "Generated", body: "The AI's words." });
ok(a.title === "Generated" && a.body === "The AI's words.", "the generated title and text replace the draft's");
ok(a.undo.length === 1 && a.undo[0].title === "Mine" && a.undo[0].body === "My own words.", "…the text it had is in undo");
ok(a.versions?.length === 2 && a.versions[0].body === "My own words." && a.versionIndex === 1, "…and kept as the previous version, with a new one started");
ok(written.title === "Mine" && written.undo.length === 0 && !written.versions, "the draft given is not changed");

// An empty draft adds no empty version or undo entry.
const e = applyGenerated(draft(), { title: "First", body: "Words." });
ok(e.undo.length === 0 && e.versions === undefined && e.body === "Words.", "an empty draft gets no empty version or undo entry");

// A title still arriving leaves the title.
const t = applyGenerated(draft({ title: "Keep" }), { title: null, body: "" });
ok(t.title === "Keep", "a title not arrived yet leaves the title alone");

// Continued: more of the same text doesn't start another version.
const c1 = applyGenerated(written, { title: "G", body: "The" });
const c2 = applyGenerated(c1, { title: "G", body: "The AI's" }, { continued: true });
const c3 = applyGenerated(c2, { title: "G", body: "The AI's words." }, { continued: true });
ok(c3.undo.length === 1 && c3.versions?.length === 2 && c3.body === "The AI's words.", "later parts of the same text add no extra version or undo");

// A second Generate: the first generated text becomes the previous version.
const second = applyGenerated(a, { title: "Again", body: "More words." });
ok(second.versions?.length === 3 && second.versions[1].body === "The AI's words." && second.undo.length === 2, "a second Generate keeps the first one as a version");

// Limits.
let d = draft({ title: "x", body: "y" });
for (let i = 0; i < MAX_UNDO + 5; i++) d = beginGenerated({ ...d, body: `text ${i}` });
ok(d.undo.length === MAX_UNDO && (d.versions?.length ?? 0) <= MAX_VERSIONS, "undo and versions are kept to their limits");
ok(pushUndo(draft()).length === 0 && startVersion(draft()).versions === undefined, "the helpers leave an empty draft alone");

// After a Generate.
const none = draft({ choices: [""] });
const r = applyAfterGenerate(none, { choiceLabel: "Go left", suggestions: ["Run", "Hide"] });
ok(r.newChoiceLabel === "Go left" && r.suggestions?.join() === "Run,Hide", "choice text and suggestions are filled in when the author has written neither");
const typed = draft({ newChoiceLabel: "Mine", choices: ["The door", ""] });
const r2 = applyAfterGenerate(typed, { choiceLabel: "Go left", suggestions: ["Run"] });
ok(r2.newChoiceLabel === "Mine" && r2.suggestions === undefined, "the author's choice text and typed choices are kept");
const r3 = applyAfterGenerate(draft({ newChoiceLabel: "   " }), { choiceLabel: "Go left" });
ok(r3.newChoiceLabel === "Go left", "a blank choice text counts as empty");
ok(applyAfterGenerate(none, {}) === none, "nothing to add gives the same draft");
