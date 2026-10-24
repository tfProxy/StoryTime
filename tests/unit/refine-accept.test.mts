// Refine: what Accept does (planAccept), matching a picture to a ComfyUI file, and the progress a session keeps for a retry.
import { planAccept, sameImage } from "../../src/lib/refine/accept.ts";
import { imageOfResultBase, newSession, ORIGINAL_BASE, readAccepting, readSession, resultBaseId } from "../../src/lib/refine/session.ts";
import type { PaintStroke } from "../../src/lib/paint.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const stroke: PaintStroke = { tool: "brush", color: "#ff0000", size: 10, softness: 0.2, opacity: 1, points: [[1, 1, 0.5, 0]] };
const st = (base: string, paint: PaintStroke[], paintVisible: boolean) => ({ base, paint, paintVisible });

// what Accept does
ok(planAccept(st(ORIGINAL_BASE, [], true)).kind === "leave", "the original with no paint: leave");
ok(planAccept(st(ORIGINAL_BASE, [stroke], false)).kind === "leave", "the original with hidden paint: leave (hidden paint is discarded)");
ok(planAccept(st(ORIGINAL_BASE, [stroke], true)).kind === "paint", "visible paint on the original: save the painted picture");
ok(planAccept(st("result:output//a.png", [], true)).kind === "result", "an applied result with no paint: keep that result");
ok(planAccept(st("result:output//a.png", [stroke], false)).kind === "result", "an applied result with hidden paint: keep the result as it is");
ok(planAccept(st("result:output//a.png", [stroke], true)).kind === "paint", "visible paint on an applied result: save the painted picture");

// ComfyUI pictures
const a = { filename: "a.png", subfolder: "StoryTime/s1", type: "output" };
ok(sameImage(a, { ...a }) && !sameImage(a, { ...a, type: "input" }) && !sameImage(a, { ...a, subfolder: "" }) && !sameImage(a, { ...a, filename: "b.png" }), "pictures are the same when type, folder and file all are");
for (const im of [a, { filename: "x y.png", subfolder: "", type: "output" }, { filename: "storytime-refine-1.png", subfolder: "deep/er/folder", type: "input" }]) {
  const back = imageOfResultBase(resultBaseId(im));
  ok(back !== null && sameImage(back, im), `a result's base id gives its picture back (${im.type}/${im.subfolder}/${im.filename})`);
}
ok(imageOfResultBase(ORIGINAL_BASE) === null && imageOfResultBase("result:") === null, "the original base and nonsense name no picture");

// Accept's progress is read defensively, and kept with the session
ok(readAccepting(null) === null && readAccepting({ sig: "", promptId: "p" }) === null && readAccepting({ sig: "s" }) === null, "no progress when it is missing or empty");
const rec = readAccepting({ sig: "s", promptId: "p", image: { filename: "u.png", subfolder: "", type: "input" }, jobId: "j", junk: 1 });
ok(rec !== null && rec.sig === "s" && rec.promptId === "p" && rec.jobId === "j" && rec.image?.filename === "u.png" && !("junk" in rec), "progress keeps the signature, the job id, the uploaded picture and nothing else");
ok(readAccepting({ sig: "s", promptId: "p", image: { filename: "", subfolder: "", type: "input" } })?.image === undefined, "…and ignores a damaged picture");
const target = { kind: "chapter", storyId: "s1", chapterId: "c1" } as const;
const s = { ...newSession({ target, original: { kind: "comfy", image: a }, now: 1, id: "abcdef12" }), accepting: { sig: "s", promptId: "p", jobId: "j" } };
const again = readSession(JSON.parse(JSON.stringify(s)));
ok(again?.accepting?.jobId === "j" && again.accepting.promptId === "p", "a stored session brings the progress back");
ok(readSession(JSON.parse(JSON.stringify(newSession({ target, original: { kind: "comfy", image: a }, now: 1, id: "abcdef12" }))))?.accepting === undefined, "…and has none otherwise");
