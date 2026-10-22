// The workflows StoryTime would send for a preset, with sample text, for trying in ComfyUI by hand
// (Settings › Drawing and the edit tabs). API-format JSON: ComfyUI opens it with Load or by dropping the file on it.
import { buildDraw, drawTuning, type FamilyCheck } from "./drawModels";
import { buildEdit, editTuning, type EditCheck } from "./editModels";
import { usesFamily, type DrawPreset, type EditPreset } from "./presets";
import { builtinSampler, fillWorkflow, parseWorkflow, type Workflow } from "./workflow";

/** The name of the sample starting picture an edit export loads: put a picture of this name in ComfyUI's input folder. */
export const SAMPLE_IMAGE = "example.png";

const loraList = (stack: { name: string; strength: number; on: boolean }[]) => stack.filter((l) => l.on && l.name).map(({ name, strength }) => ({ name, strength }));

/**
 * A drawing preset's workflow with a sample prompt. A model-family preset needs its `family` check ready (the
 * files are the ones ComfyUI has); null when it isn't. A checkpoint preset is filled from its own workflow, or the built-in one.
 */
export function drawPresetWorkflow(preset: DrawPreset, family: FamilyCheck | null, size: { width: number; height: number }): Workflow | null {
  const common = {
    prompt: "a fox sitting on a hill at sunset", negative: preset.negative, seed: 1, count: 1,
    width: size.width, height: size.height, prefix: "StoryTime-test", loras: loraList(preset.loras),
  };
  if (usesFamily(preset)) {
    if (!family?.ready) return null;
    return buildDraw(family, { ...common, tuning: drawTuning(family.model, preset.sampler), textEncoderDevice: preset.textEncoderDevice });
  }
  return fillWorkflow(parseWorkflow(preset.workflow), { ...common, checkpoint: preset.checkpoint, sampler: builtinSampler(preset.sampler) });
}

/** An edit preset's workflow with a sample instruction, from `SAMPLE_IMAGE`; `check` is the preset's (see editPresetCheck), null when it isn't ready. */
export function editPresetWorkflow(preset: EditPreset, check: EditCheck | null): Workflow | null {
  if (!check?.ready) return null;
  const tuning = editTuning(check.model, preset.tuning);
  return buildEdit(
    check,
    {
      image: SAMPLE_IMAGE, instruction: "make the jacket red", seed: 1, count: 1, width: 1024, height: 1024, prefix: "StoryTime-test",
      denoise: tuning.strength, loras: loraList(preset.loras), tuning, textEncoderDevice: preset.textEncoderDevice,
    },
    preset.fast,
  );
}

/** Saves a workflow as a .json file named after the preset (browser only). */
export function downloadWorkflow(name: string, wf: Workflow) {
  const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `storytime-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
