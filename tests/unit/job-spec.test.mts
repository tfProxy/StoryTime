// JobSpec: a job turned into plain data and back keeps what sameJob compares, and the pictures are fetched by source.
import { fromSpec, maskUploadKey, toSpec } from "../../src/lib/comfy/jobSpec.ts";
import { refsOf, sameJob, type JobInput } from "../../src/lib/comfy/makeJob.ts";
import { DEFAULT_DRAW_PRESETS } from "../../src/lib/comfy/presets.ts";
import type { EditCheck } from "../../src/lib/comfy/editModels.ts";
import type { Reference } from "../../src/lib/comfy/references.ts";
import type { StartPicture } from "../../src/lib/comfy/startPicture.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const png = (tag: string) => new Blob([tag], { type: "image/png" });
const text = (b: Blob) => b.text();

const start = (key: string, source = key): StartPicture => ({ key, source, thumb: `/thumb/${key}`, blob: async () => png(`browser:${key}`) });
const ref = (key: string, role: Reference["role"] = "character"): Reference => ({ key, source: key, label: `Ref ${key}`, role, weight: 0.5, thumb: `/thumb/${key}`, blob: async () => png(`browser:${key}`) });

const base: JobInput = {
  prompt: "a red fox",
  negative: "blurry",
  moment: "header",
  comfy: DEFAULT_SETTINGS.comfy,
  draw: DEFAULT_DRAW_PRESETS[0],
  drawLoras: [],
  family: null,
  redraw: 0.55,
  start: null,
  edit: null,
  seed: null,
};

const edit = {
  check: { model: { id: "qwen" } } as unknown as EditCheck,
  instruction: "make it night",
  strength: 0.8,
  fast: true,
  loras: [],
  tuning: {} as never,
  textEncoderDevice: "default" as never,
};

const mask = { strokes: [{ tool: "brush" as const, size: 20, points: [[1, 2, 0.5] as [number, number, number]] }], softness: 2, inverted: false, id: "m1", width: 96, height: 60 };

const never = async (s: string): Promise<Blob> => { throw new Error(`unexpected fetch of ${s}`); };
const roundTrip = (input: JobInput, uploaded: Record<string, string> = {}) => {
  const spec = toSpec(input, uploaded);
  // It has to survive being sent as JSON.
  return fromSpec(JSON.parse(JSON.stringify(spec)), never);
};

// A drawing job.
const drawing: JobInput = { ...base, seed: 7 };
ok(sameJob(roundTrip(drawing)) === sameJob(drawing), "a drawing job keeps its sameJob key");
ok(roundTrip(drawing).start === null && roundTrip(drawing).mask === null, "a drawing job has no start and no mask");

// An edit with a start.
const editing: JobInput = { ...base, start: start("comfy:a/b.png"), edit };
const editBack = roundTrip(editing);
ok(sameJob(editBack) === sameJob(editing), "an edit job with a start keeps its sameJob key");
ok(editBack.start?.key === "comfy:a/b.png" && editBack.start.thumb === "", "the start keeps its key and has no thumbnail");

// A redraw with a mask.
const redraw: JobInput = { ...base, start: start("saved:c1:header:3", "saved:c1:header"), mask };
const redrawSpec = toSpec(redraw, { [maskUploadKey("m1")]: "upload:mask-1" });
ok(redrawSpec.mask?.source === "upload:mask-1" && redrawSpec.mask.id === "m1", "the mask is sent as its uploaded source and keeps its id");
ok(!("strokes" in (redrawSpec.mask ?? {})), "the strokes are not sent");
const redrawBack = fromSpec(JSON.parse(JSON.stringify(redrawSpec)), async (s) => png(`server:${s}`));
ok(sameJob(redrawBack) === sameJob(redraw), "a redraw with a mask keeps its sameJob key");
ok(redrawBack.mask?.width === 96 && redrawBack.mask.height === 60, "the mask keeps its size");
ok((await text(await redrawBack.mask!.render!())) === "server:upload:mask-1", "the mask's render fetches its upload");
let threw = false;
try { toSpec(redraw, {}); } catch { threw = true; }
ok(threw, "a mask that was not uploaded is refused");

// A job with refs.
const withRefs: JobInput = { ...base, refs: [ref("comfy:r1.png"), ref("upload:x.png", "style")] };
const refsBack = roundTrip(withRefs);
ok(sameJob(refsBack) === sameJob(withRefs), "a job with refs keeps its sameJob key");
ok(refsOf(refsBack).map((r) => `${r.key}/${r.role}/${r.weight}/${r.label}`).join() === refsOf(withRefs).map((r) => `${r.key}/${r.role}/${r.weight}/${r.label}`).join(), "the refs keep their key, role, weight and label");

// Fetching: by source, or by the upload when the browser had to send the picture.
const fetched: string[] = [];
const resolve = async (s: string) => { fetched.push(s); return png(`server:${s}`); };
const saved = fromSpec(toSpec({ ...base, start: start("saved:c1:header:3", "saved:c1:header") }, {}), resolve);
ok((await text(await saved.start!.blob())) === "server:saved:c1:header" && fetched[0] === "saved:c1:header", "a saved start is fetched by its source");
const uploadedStart = fromSpec(toSpec({ ...base, start: start("refine:s1:flat", "saved:c1:header") }, { "refine:s1:flat": "upload:flat-1" }), resolve);
ok(fetched.length === 1, "building the job fetches nothing");
ok((await text(await uploadedStart.start!.blob())) === "server:upload:flat-1", "an uploaded start is fetched by its upload");
ok(uploadedStart.start?.source === "saved:c1:header", "an uploaded start still records its original source");
const uploadedRef = fromSpec(toSpec({ ...base, refs: [ref("upload:pick.png")] }, { "upload:pick.png": "upload:pick-9" }), resolve);
ok((await text(await uploadedRef.refs![0].blob())) === "server:upload:pick-9", "an uploaded ref is fetched by its upload");
