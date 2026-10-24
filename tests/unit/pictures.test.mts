import { pictureCaption, pictureDetails, pictureMarkdown, sourceText, timeline, type Picture } from "../../src/components/pictures.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const titles = { c1: "The lamp", c2: "The cellar" };
const base: Picture = {
  key: "j1-1",
  jobId: "j1",
  index: 1,
  image: { filename: "StoryTime_00002_.png", subfolder: "StoryTime/s1/c1", type: "output" },
  prompt: "a lighthouse at dawn, ```gulls```",
  negative: "blurry, text",
  seed: 4242,
  checkpoint: "fake_sdxl_a.safetensors",
  width: 1344,
  height: 768,
  denoise: null,
  source: null,
  moment: "start",
  chapterId: "c1",
  madeAt: Date.UTC(2026, 9, 20, 12, 0),
  batch: 3,
  mark: null,
  fresh: false,
};
const value = (p: Picture, label: string) => pictureDetails(p, titles).find((d) => d.label === label)?.value;

// ---- details ----
ok(value(base, "Chapter") === "“The lamp”, chapter start", "the chapter and the moment");
ok(value(base, "Seed") === "4242" && value(base, "Size") === "1344 × 768" && value(base, "Checkpoint") === "fake_sdxl_a.safetensors", "seed, size and checkpoint");
ok(value(base, "Batch") === "picture 2 of 3 (batch size 3, batch index 1)", "a picture from a batch says which one it is");
ok(value({ ...base, batch: 1, index: 0 }, "Batch") === undefined, "…and a picture made alone doesn't");
ok(value(base, "Started from") === undefined && value(base, "Strength (denoise)") === undefined, "a picture from the prompt alone has no starting picture or strength");
ok(value(base, "File") === "StoryTime/s1/c1/StoryTime_00002_.png (ComfyUI output)", "the file ComfyUI keeps it under");
ok(value({ ...base, chapterId: "gone" }, "Chapter") === "A chapter that has been removed, chapter start", "a removed chapter says so");
const varied = { ...base, source: "comfy:StoryTime/s1/c1/a.png", denoise: 0.55 };
ok(value(varied, "Started from") === "ComfyUI picture StoryTime/s1/c1/a.png" && value(varied, "Strength (denoise)") === "0.55", "a picture made from a ComfyUI picture names it and the strength");
ok(sourceText("saved:c2:footer", titles) === "the saved footer picture of “The cellar”", "a saved picture names its slot and chapter");

// ---- Markdown ----
const md = pictureMarkdown(base, titles);
ok(md.includes("````\na lighthouse at dawn, ```gulls```\n````"), "the prompt is in a code block fenced longer than the backticks in it");
ok(md.includes("## Negative prompt\n\n```\nblurry, text\n```"), "the negative prompt is in its own code block");
ok(md.includes("- **Seed:** 4242") && md.includes("- **Batch:** picture 2 of 3"), "the settings are a list");
ok(pictureMarkdown({ ...base, negative: "" }, titles).includes("## Negative prompt\n\nNone."), "no negative prompt says None");

// ---- timeline: the runs the separators fall between ----
const p = (key: string, prompt: string): Picture => ({ ...base, key, prompt });
const runs = timeline([], [p("c", "B"), p("b", "A"), p("a", "A")]);
ok(runs.length === 2 && runs[1].pictures.length === 2, "neighbours with the same settings share a run");

// ---- captions ----
const caption = (checkpoint: string, editModel: string | null = null) => pictureCaption({ seed: 1, checkpoint, width: 1344, height: 768, denoise: null, editModel });
ok(caption("sdxl/juggernaut.safetensors") === "sdxl/juggernaut · 1344 × 768", "a picture's caption names its checkpoint and size");
ok(caption("juggernaut.safetensors + styles/ink.safetensors (0.8) + hero.safetensors (-0.5)") === "juggernaut · 2 LoRAs · 1344 × 768", "…and counts a drawing preset's LoRAs");
ok(caption("qwen.safetensors + a.safetensors (1)", "qwen-image-edit") === "Qwen-Image-Edit · 1 LoRA · 1344 × 768", "…as it does an edit's");

// ---- a picture redrawn in a painted area only (earlier pictures, and the Refine screen's) ----
const painted = { ...base, source: "comfy:StoryTime/s1/c1/a.png", denoise: 0.5, mask: "storytime-mask-1.png" };
ok(value(painted, "Area") === "painted part only" && value(base, "Area") === undefined, "Info says “Area: painted part only” for a picture made with a mask, and nothing otherwise");
ok(pictureCaption(painted).includes("painted area") && pictureCaption(painted).includes("strength 0.5") && !pictureCaption(base).includes("painted area"), "…and its caption says “painted area” and the strength");

// ---- temporary pictures: only an unpinned one is labelled temporary ----
const temp = { ...base, temporary: true, mark: null };
ok(pictureCaption(temp).includes("temporary") && value(temp, "Temporary") !== undefined, "an unpinned temporary picture says “temporary” in its caption and in Info");
const kept = { ...temp, mark: "pinned" as const };
ok(!pictureCaption(kept).includes("temporary") && value(kept, "Temporary") === undefined, "a pinned temporary picture (an accepted Refine result) is a kept picture: no “temporary” label");
ok(pictureCaption({ ...temp, mark: "rejected" }).includes("temporary"), "…while a rejected one still is");
