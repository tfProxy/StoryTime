// Fill missing pictures: the job a picture task becomes, built as the Illustrate page builds one text-to-image picture.
import { buildPictureJob, momentOf, presetOf, type PictureSetup } from "../../src/lib/aiRuns/pictures.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";
import { newDrawPreset } from "../../src/lib/comfy/presets.ts";
import type { PictureTask } from "../../src/lib/aiRuns/types.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const preset = { ...newDrawPreset("p1", "Test preset", "sdxl.safetensors"), prompt: "masterpiece", negative: "blurry", loras: [{ name: "a.safetensors", strength: 0.6, on: true }, { name: "gone.safetensors", strength: 1, on: true }, { name: "off.safetensors", strength: 1, on: false }] };
const settings = { ...DEFAULT_SETTINGS, comfy: { ...DEFAULT_SETTINGS.comfy, url: "http://comfy.test", width: 1344, height: 768, drawPresets: [preset] } };
const setup: PictureSetup = {
  story: { id: "s1", title: "Tale", premise: "A premise", art_style: "watercolour", draw_preset: null, style_ref: null },
  chapterPreset: null,
  fixed: "red scarf",
  context: { story: { id: "s1", title: "Tale", premise: "A premise", style: "" }, path: [], codex: [], choices: [] },
};
const task = (slot: "header" | "footer"): PictureTask => ({ kind: "picture", id: "t1", chapterId: "c1", slot, label: "One", status: "written", prompt: "a harbour", negative: "ugly" });
const models = { state: "done" as const, ready: [], checks: [], families: [], ipAdapters: [], loras: ["a.safetensors"], samplers: [], schedulers: [] };
const build = (t: PictureTask, extra = {}, s = settings, m: Parameters<typeof buildPictureJob>[4] = models) => buildPictureJob(s, setup, t, { prompt: t.prompt ?? "", negative: t.negative ?? "" }, m, extra, "pictures:run1");

const built = build(task("header"));
ok("job" in built, "a job is built for a written task");
if ("job" in built) {
  const { input } = built.job;
  ok(input.prompt.includes("masterpiece") && input.prompt.includes("red scarf") && input.prompt.includes("a harbour"), "the prompt has the preset's text, the chapter's always-included text and the written prompt");
  ok(input.negative.includes("ugly") && input.negative.includes("blurry"), "…and the negative has the preset's");
  ok(input.moment === "start" && momentOf("footer") === "end", "a header is the chapter's start, a footer its end");
  ok(input.session === "pictures:run1" && input.base === "t1", "the job carries the run's session and task, so the queue hands the picture back to the run");
  ok(input.start === null && input.edit === null && input.seed === null && !input.temporary, "it is a plain text-to-image job, not temporary");
  ok(input.draw.id === "p1" && presetOf(settings, setup).id === "p1", "it uses the drawing preset of the story (or chapter)");
  ok(input.drawLoras.map((l) => l.name).join() === "a.safetensors", "only the preset's LoRAs that are on and in ComfyUI are used");
  ok(input.comfy.width === 1344 && input.comfy.height === 768, "the size is the one in Settings");
  ok(input.refs === undefined, "no reference pictures unless asked for");
}
const scaled = build(task("header"), {}, { ...settings, comfy: { ...settings.comfy, sizeScale: 0.5 } });
ok("job" in scaled && scaled.job.input.comfy.width === 672 && scaled.job.input.comfy.height === 384, "the size multiplier is applied, to a multiple of 16");
const wantsRefs = build(task("footer"), { useRefs: true });
ok("job" in wantsRefs && wantsRefs.job.input.refs === undefined && wantsRefs.job.input.moment === "end", "references asked for but IP-Adapter not available: none, and no complaint");
ok("problem" in build(task("header"), {}, { ...settings, comfy: { ...settings.comfy, url: "" } }) && ("problem" in build(task("header"), {}, settings, { state: "error", message: "down" })), "no ComfyUI address, or ComfyUI not answering, is a problem to stop with");
const family = newDrawPreset("fam", "Flux", "");
const famSettings = { ...settings, comfy: { ...settings.comfy, drawPresets: [{ ...family, family: "flux" as const, workflow: "" }] } };
const famResult = build(task("header"), {}, famSettings);
ok("problem" in famResult && famResult.problem.includes("can't draw yet"), "a model-family preset whose files ComfyUI lacks is a problem, with the reason");
