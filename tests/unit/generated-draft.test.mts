import { emptyDraft } from "../../src/lib/drafts.ts";
import { applyAfterGenerate, applyGenerated, beginGenerated, isBegun, MAX_UNDO, MAX_VERSIONS, pushUndo, restore, snapshot, startVersion } from "../../src/lib/generatedDraft.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const draft = (extra = {}) => ({ ...emptyDraft("fill:c1", "/c/p/write?choice=c1", "Story: “Go”"), ...extra });

// A draft with text: the text is kept as the previous version and in undo.
const written = draft({ title: "Mine", body: "My own words." });
const a = applyGenerated(written, { title: "Generated", body: "The AI's words." });
ok(a.title === "Generated" && a.body === "The AI's words.", "the generated title and text replace the draft's");
ok(a.undo.length === 1 && a.undo[0].title === "Mine" && a.undo[0].body === "My own words.", "…the text it had is in undo");
ok(a.versions?.length === 2 && a.versions[0].body === "My own words." && a.versionIndex === 1, "…and kept as the previous version, with a new one started");
ok(written.title === "Mine" && written.undo.length === 0 && !written.versions, "the draft given is not changed");

// An empty draft adds no undo entry; its first Generate is its first version, with the prompt that made it.
const e = applyGenerated(draft({ prompt: "A storm comes." }), { title: "First", body: "Words." });
ok(e.undo.length === 0 && e.versions?.length === 1 && e.versionIndex === 0 && e.versions[0].prompt === "A storm comes." && e.body === "Words.", "an empty draft gets no undo entry; its Generate is draft 1, with its prompt");

// Each version keeps the prompt that made it; a prompt given to the Generate wins over the box.
const p1 = applyGenerated(draft({ prompt: "one" }), { title: "G1", body: "First." });
const p2 = applyGenerated({ ...p1, prompt: "two" }, { title: "G2", body: "Second." });
const p3 = applyGenerated({ ...p2, prompt: "typed since" }, { title: "G3", body: "Third." }, { prompt: "three" });
ok(p3.versions?.map((v) => v.prompt).join() === "one,two,three" && p3.versions[0].body === "First." && p3.versions[1].body === "Second.", "each draft keeps its own prompt");

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
ok(pushUndo(draft()).length === 0 && startVersion(draft()).versions?.length === 1, "an empty draft gets no undo entry, and one version to write into");

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

// Whether a Generate has been begun in a draft, so two places can apply its text without telling each other.
const base = { title: "Mine", body: "My own words." };
ok(!isBegun(written, base), "a draft still holding the starting text hasn't been begun");
const begun = applyGenerated(written, { title: "G", body: "The" });
ok(isBegun(begun, base), "…after the first text it has");
ok(isBegun(applyGenerated(begun, { title: "G", body: "The AI" }, { continued: isBegun(begun, base) }), base) && applyGenerated(begun, { title: "G", body: "The AI" }, { continued: isBegun(begun, base) }).undo.length === 1, "…and applying again by that check adds no second undo entry");
ok(isBegun(draft(), { title: "", body: "" }), "a Generate that started from an empty draft is always begun (nothing to keep)");
ok(!isBegun(draft({ undo: [{ title: "older", body: "older" }] }), base), "a different last undo entry doesn't count");

// The kept AI requests that wrote the text (`ai`) follow it into versions and undo.
const g1 = applyGenerated(draft({ title: "Mine", body: "My words." }), { title: "G1", body: "First." }, { ai: "id1" });
ok(JSON.stringify(g1.ai) === '["id1"]' && !g1.undo[0].ai && !g1.versions![0].ai, "a Generate's text points to its request; the hand-written text before it has none");
const g1more = applyGenerated(g1, { title: "G1", body: "First, longer." }, { continued: true });
ok(JSON.stringify(g1more.ai) === '["id1"]', "more text of the same Generate keeps it");
const g2 = applyGenerated(g1more, { title: "G2", body: "Second." }, { ai: "id2" });
ok(JSON.stringify(g2.ai) === '["id2"]' && JSON.stringify(g2.undo.at(-1)!.ai) === '["id1"]' && JSON.stringify(g2.versions![g2.versions!.length - 2].ai) === '["id1"]', "a new Generate replaces it; the text before keeps its own in undo and versions");
const g3 = applyGenerated({ ...g2, ai: ["old"] }, { title: "G3", body: "Third." });
ok(g3.ai === undefined, "a new Generate's text without an id yet has none, not the previous text's");
ok(JSON.stringify(restore(snapshot(g2))) === JSON.stringify({ title: "G2", body: "Second.", ai: ["id2"] }) && !("ai" in snapshot(draft({ title: "x", body: "y" }))), "snapshot and restore carry the requests; hand-written text has no `ai`");
