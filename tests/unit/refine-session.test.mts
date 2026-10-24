import { readTag } from "../../src/lib/comfy/jobTag.ts";
import { maskId, maskUsed, paintUsed, sentPictureKey, sentPrompts } from "../../src/lib/refine/send.ts";
import { addResults, MAX_RESULTS, deleteSession, isSessionId, loadSession, newSession, newSessionId, originalOf, pruneSessions, readSession, saveSession, serializeSession, SESSION_KEY, MAX_SESSION_BYTES } from "../../src/lib/refine/session.ts";
import { DEFAULT_TOOLS, readTools } from "../../src/lib/refine/tools.ts";
import { addPaintStroke, commit, initialRefineState, redo, setMask, undo } from "../../src/lib/refineHistory.ts";
import type { PaintStroke } from "../../src/lib/paint.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// A stand-in for localStorage.
function fakeStorage(limit = Infinity) {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { if (v.length > limit) throw new Error("QuotaExceededError"); m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}

const stroke = (n: number, points = 1): PaintStroke => ({ tool: "brush", color: "#ff0000", size: 10, softness: 0.2, opacity: 1, points: Array.from({ length: points }, (_, i) => [n + i, n, 0.5, i * 10] as [number, number, number, number]) });
const target = { kind: "chapter", storyId: "s1", chapterId: "c1" } as const;
const original = { kind: "comfy", image: { filename: "a.png", subfolder: "StoryTime/s1", type: "output" } } as const;

// ids
const id = newSessionId();
ok(isSessionId(id) && id.length >= 12, "a new session id is a short random token");
ok(newSessionId() !== newSessionId(), "ids differ");
ok(!isSessionId("../x") && !isSessionId("tools") && !isSessionId(""), "odd ids are not sessions");

// round trip
const st = fakeStorage();
let s = newSession({ target, original, prompt: "a cat", negative: "blurry", loras: { p: { "0": { name: "x.safetensors", on: false } } }, now: 1000 });
s = { ...s, history: commit(commit(s.history, addPaintStroke(s.history.present, stroke(1))), setMask(addPaintStroke(s.history.present, stroke(1)), { softness: 6, inverted: true })) };
ok(saveSession(s, st, 2000), "a session is saved");
const back = loadSession(s.id, st);
ok(back !== null && back.id === s.id && back.updatedAt === 2000 && back.createdAt === 1000, "it loads back, with when it was saved");
ok(JSON.stringify(back?.history) === JSON.stringify(s.history), "the history round-trips");
ok(back?.prompt === "a cat" && back?.negative === "blurry" && JSON.stringify(back?.loras) === JSON.stringify(s.loras), "prompt, negative and LoRAs are kept");
ok(JSON.stringify(back?.original) === JSON.stringify(original) && JSON.stringify(back?.target) === JSON.stringify(target), "origin and target are kept");
ok(back !== null && undo(back.history).present.paint.length === 1 && undo(undo(back.history)).present.paint.length === 0 && redo(undo(back.history)).present === back.history.present, "undo and redo still work on a loaded history");
deleteSession(s.id, st);
ok(loadSession(s.id, st) === null && st.raw.size === 0, "a deleted session is gone");
ok(loadSession(s.id, null) === null && !saveSession(s, null) && pruneSessions(14, null) === 0, "without storage nothing fails");

// the other origins
for (const t of [{ kind: "cover", storyId: "s1" }, { kind: "codex", storyId: "s1", entryId: "e1" }] as const) {
  const x = newSession({ target: t, original: { kind: "saved", slot: "cover", version: 3 } });
  ok(saveSession(x, st) && JSON.stringify(loadSession(x.id, st)?.target) === JSON.stringify(t), `a ${t.kind} target round-trips`);
}
const x2 = newSession({ target, original: { kind: "codex", pictureId: "p9" } });
ok(saveSession(x2, st) && JSON.stringify(loadSession(x2.id, st)?.original) === JSON.stringify({ kind: "codex", pictureId: "p9" }), "a codex picture origin round-trips");

// originalOf
ok(JSON.stringify(originalOf({ image: { filename: "a.png", subfolder: "", type: "output" }, source: "comfy:a.png", key: "comfy:a.png" })) === JSON.stringify({ kind: "comfy", image: { filename: "a.png", subfolder: "", type: "output" } }), "a ComfyUI picture is its image");
ok(JSON.stringify(originalOf({ slot: "header", source: "saved:c1:header", key: "saved:c1:header:7" })) === JSON.stringify({ kind: "saved", slot: "header", version: 7 }), "a saved slot keeps the version it had");
ok(JSON.stringify(originalOf({ source: "codex:p1", key: "codex:p1" })) === JSON.stringify({ kind: "codex", pictureId: "p1" }), "a codex picture is its id");
ok(originalOf({ source: "upload:x", key: "upload:x" }) === null, "anything else can't be fetched again");

// defensive validation
const good = JSON.parse(JSON.stringify(s));
ok(readSession(good) !== null, "a good value reads");
ok(readSession(null) === null && readSession("x") === null && readSession([]) === null && readSession({}) === null, "non-sessions are refused");
ok(readSession({ ...good, id: "../../etc" }) === null, "a bad id is refused");
ok(readSession({ ...good, target: { kind: "chapter", storyId: "s1" } }) === null, "a target missing its chapter is refused");
ok(readSession({ ...good, target: { kind: "nope", storyId: "s1" } }) === null, "an unknown target kind is refused");
ok(readSession({ ...good, original: { kind: "comfy", image: { filename: "", subfolder: "", type: "output" } } }) === null, "an original with no file is refused");
ok(readSession({ ...good, original: { kind: "saved", slot: "banner", version: 1 } }) === null, "an unknown slot is refused");
ok(readSession({ ...good, history: { past: [], future: [] } }) === null, "a history with no present is refused");
ok(readSession({ ...good, history: { ...good.history, present: { ...good.history.present, mask: { strokes: "x", softness: 0, inverted: false } } } }) === null, "a broken mask is refused");
const messy = readSession({ ...good, history: { ...good.history, present: { ...good.history.present, paint: [{ tool: "brush", color: "red", size: 5, softness: 0, opacity: 1, points: [[1, 1]] }, good.history.present.paint[0]] } } });
ok(messy !== null && messy.history.present.paint.length === 1, "a broken paint stroke is dropped, the rest kept");
ok(readSession({ ...good, history: { ...good.history, past: [5, good.history.past[0]] } })?.history.past.length === 1, "a broken history entry is dropped");
ok(readSession({ ...good, history: { ...good.history, present: { ...good.history.present, paintVisible: false } } })?.history.present.paintVisible === false, "visibility is kept");
st.raw.set(SESSION_KEY("abcdef123456"), "{not json");
ok(loadSession("abcdef123456", st) === null, "unparsable JSON is no session");

// size cap
let big = newSession({ target, original });
let h = big.history;
for (let i = 0; i < 40; i++) h = commit(h, addPaintStroke(h.present, stroke(i, 400)));
big = { ...big, history: h };
const full = JSON.stringify(big).length;
const json = serializeSession(big, Math.floor(full / 2));
const cut = json ? JSON.parse(json) : null;
ok(json !== null && json.length <= full / 2, "an oversized session is cut to the cap");
ok(cut && cut.history.past.length < big.history.past.length && cut.history.present.paint.length === 40, "…by dropping the oldest history, never the present");
ok(cut && cut.history.past.at(-1).paint.length === 39, "…and the newest history is kept");
ok(serializeSession(big, 100) === null, "a present that alone is too big can't be saved");
ok(serializeSession(s, MAX_SESSION_BYTES) === JSON.stringify(s), "a small session is saved whole");
const tight = fakeStorage(Math.floor(full / 2));
ok(saveSession(big, tight) && (loadSession(big.id, tight)?.history.present.paint.length ?? 0) === 40, "a full storage gets a shorter history");

// pruning
const old = fakeStorage();
const day = 86_400_000;
const a = newSession({ target, original, now: 0, id: "aaaaaaaaaaaa" });
const b = newSession({ target, original, now: 0, id: "bbbbbbbbbbbb" });
saveSession(a, old, 1 * day);
saveSession(b, old, 20 * day);
old.setItem("storytime.refine.tools", JSON.stringify(DEFAULT_TOOLS));
old.setItem("storytime.refine.cccccccccccc", "garbage");
old.setItem("other.key", "1");
const gone = pruneSessions(14, old, 21 * day);
ok(gone === 2, "an old session and a broken one are pruned");
ok(old.getItem(SESSION_KEY("bbbbbbbbbbbb")) !== null && old.getItem(SESSION_KEY("aaaaaaaaaaaa")) === null, "a recent session stays");
ok(old.getItem("storytime.refine.tools") !== null && old.getItem("other.key") === "1", "tool settings and other keys are left alone");

// tool settings
ok(JSON.stringify(readTools(null)) === JSON.stringify(DEFAULT_TOOLS), "no stored tools gives the defaults");
const t = readTools({ color: "#ABC", size: 99999, softness: -2, opacity: "x", maskSize: 30 });
ok(t.color === "#aabbcc" && t.size === 2000 && t.softness === 0 && t.opacity === DEFAULT_TOOLS.opacity && t.maskSize === 30, "stored tools are cleaned");
ok(readTools({ color: "red" }).color === DEFAULT_TOOLS.color, "a bad colour falls back");
const t2 = readTools({ strengths: { test: 0.3, bad: "x", low: 0, "": 1 }, queueCount: 4 });
ok(JSON.stringify(t2.strengths) === JSON.stringify({ test: 0.3, low: 0.05 }) && t2.queueCount === 4, "the last strength per drawing preset and Pictures per click are read back, cleaned");
ok(readTools({ queueCount: 3 }).queueCount === null && readTools({}).queueCount === null && Object.keys(readTools({ strengths: [1] }).strengths).length === 0, "a Pictures per click that isn't offered, or no strengths, give the defaults");

// results and the Prompt panel's fields
const res = (n: number) => ({ image: { filename: `r${n}.png`, subfolder: "StoryTime/s1", type: "output" }, prompt: `p${n}`, negative: "", seed: n, madeFrom: "original", at: n });
const fresh = newSession({ target, original, prompt: "a lamp", negative: "dark", now: 0, id: "dddddddddddd" });
ok(fresh.results.length === 0 && fresh.sourcePrompt === "a lamp" && fresh.sourceNegative === "dark" && fresh.sourceAlways === undefined, "a new session has no results and keeps the picture's prompt as its Reset source");
ok(newSession({ target, original, now: 0, id: "eeeeeeeeeeee" }).sourcePrompt === undefined, "a picture with no prompt leaves the source for the panel to work out");
let list = addResults([], [res(1), res(2)]);
list = addResults(list, [res(2), res(3)]);
ok(list.map((r) => r.seed).join() === "1,2,3", "a result already in the list isn't added twice");
let many = addResults([], Array.from({ length: MAX_RESULTS + 5 }, (_, i) => res(i)));
ok(many.length === MAX_RESULTS && many[0].seed === 5 && many.at(-1)?.seed === MAX_RESULTS + 4, "the list is capped, the oldest dropped");
const kept = fakeStorage();
const withFields = { ...fresh, sourceAlways: "gold", boxPrompt: "typed", boxNegative: "", boxAlways: "silver", loraChanges: { test: { "0": { name: "a.safetensors", strength: 0.3 } } }, results: [res(1)] };
saveSession(withFields, kept);
const reloaded = loadSession(withFields.id, kept)!;
ok(reloaded.sourceAlways === "gold" && reloaded.boxPrompt === "typed" && reloaded.boxNegative === "" && reloaded.boxAlways === "silver" && reloaded.results.length === 1 && reloaded.results[0].madeFrom === "original", "the Prompt panel's fields and the results are saved and read back");
ok(reloaded.loraChanges?.test?.["0"]?.strength === 0.3, "the LoRA changes made on this screen are kept");
const legacy = JSON.parse(JSON.stringify(fresh));
delete legacy.results;
delete legacy.sourcePrompt;
const old2 = readSession(legacy)!;
ok(Array.isArray(old2.results) && old2.results.length === 0 && old2.sourcePrompt === undefined && old2.loraChanges === undefined, "a session saved before results existed reads with none");
const damaged = readSession({ ...JSON.parse(JSON.stringify(withFields)), results: [res(1), { image: { filename: "" } }, "x", { ...res(2), seed: "no" }], loraChanges: "x", boxPrompt: 4 })!;
ok(damaged.results.length === 1 && damaged.loraChanges === undefined && damaged.boxPrompt === undefined, "damaged results, LoRA changes and boxes are dropped one by one");

// what Go sends
const draw = { prompt: "masterpiece", negative: "blurry", promptStyle: "tags" } as const;
const sent = sentPrompts(draw, "gold light", "a lamp", "dark");
ok(sent.prompt === "masterpiece, gold light, a lamp" && sent.negative === "dark, blurry", "the prompt is preset text, Always add, then the box; the negative box then the preset's");
const plain = sentPrompts({ prompt: "", negative: "", promptStyle: "tags" }, "", "a lamp,  ", "dark");
ok(plain.prompt === "a lamp,  " && plain.negative === "dark", "with nothing to add the boxes are used as typed");
ok(sentPrompts(draw, "", "masterpiece, a lamp", "").prompt === "masterpiece, a lamp", "text the box already has isn't repeated");
{
const st = initialRefineState("original");
ok(!paintUsed(st) && maskUsed(st) === null, "an empty editor uses no paint and no mask");
const painted = addPaintStroke(st, stroke(1));
ok(paintUsed(painted) && !paintUsed({ ...painted, paintVisible: false }), "paint is used only while it is visible");
const k1 = sentPictureKey("sess", painted);
ok(k1 === sentPictureKey("sess", { ...painted }) && k1 !== sentPictureKey("sess", addPaintStroke(painted, stroke(2))) && k1 !== sentPictureKey("sess", st), "the same picture and paint give the same key, other paint another");
ok(sentPictureKey("sess", { ...painted, paintVisible: false }) === sentPictureKey("sess", st) && k1 !== sentPictureKey("other", painted), "hidden paint is the clean picture's key; another session another key");
const ms = { strokes: [{ tool: "brush" as const, size: 10, points: [[1, 2, 0.5] as [number, number, number]] }], softness: 0, inverted: false };
ok(maskUsed({ ...st, mask: ms }) === ms && maskUsed({ ...st, mask: ms, maskVisible: false }) === null && maskUsed({ ...st, mask: { ...ms, strokes: [] } }) === null, "a mask is used only when it is visible and has strokes");
ok(maskId(ms) === maskId({ ...ms }) && maskId(ms) !== maskId({ ...ms, softness: 4 }) && maskId(ms) !== maskId({ ...ms, inverted: true }) && maskId(ms) !== maskId({ ...ms, strokes: [] }), "a mask's id changes with its strokes, soft edge and inversion, and is otherwise stable");
}

// the job tag carries the session
const jtag = { chapterId: "c1", storyId: "s1", clientId: "storytime-x", job: { prompt: "a lamp", negative: "", checkpoint: "a", width: 8, height: 8, seed: 1, count: 1, moment: "start", temporary: true }, session: "abcdef123456", base: "original" };
const read = readTag({ storytime: jtag });
ok(read?.session === "abcdef123456" && read.base === "original" && read.job.temporary === true, "a job tag reads back the Refine session and base");
ok(readTag({ storytime: { ...jtag, session: 5 } }) === null && readTag({ storytime: { ...jtag, session: undefined, base: undefined } })?.session === undefined, "a damaged session in a tag is refused; no session is fine");
