// What ComfyUI has for each model, as the Illustrate page and Make missing pictures work from it. Pure data and
// helpers, so the server can use them too; the React hook that asks ComfyUI is `useEditModels`.
import type { modelChecksFor } from "./check";
import { familyPresetCheck, type FamilyCheck } from "./drawModels";
import { baseOf, type IpAdapterCheck } from "./ipAdapter";
import type { EditCheck } from "./editModels";
import { usesFamily, type DrawPreset } from "./presets";

export type EditModels =
  | { state: "checking" }
  | {
      state: "done";
      /** The models ComfyUI can run with the files found by their names, with the files to use. */
      ready: EditCheck[];
      /** What ComfyUI has for every model, ready or not, for presets that choose their own files (see editPresetCheck). */
      checks: EditCheck[];
      /** What ComfyUI has for every drawing model family, for drawing presets that use one (see drawPresetFamily). */
      families: FamilyCheck[];
      /** What ComfyUI has for IP-Adapter (reference pictures) for each model base (see drawPresetIpAdapter). */
      ipAdapters: IpAdapterCheck[];
      /** Every LoRA file ComfyUI lists, for the author's LoRA stacks. */
      loras: string[];
      /** The samplers and schedulers ComfyUI offers, for Settings. */
      samplers: string[];
      schedulers: string[];
    }
  | { state: "error"; message: string };

/** What `modelChecksFor` found, as the state the Illustrate page and Make missing pictures work from. */
export function toEditModels({ edits: checks, families, ipAdapters }: Awaited<ReturnType<typeof modelChecksFor>>): Extract<EditModels, { state: "done" }> {
  return {
    state: "done",
    ready: checks.filter((c) => c.ready),
    checks,
    families,
    ipAdapters,
    loras: checks[0]?.loras ?? [],
    samplers: checks[0]?.samplers ?? [],
    schedulers: checks[0]?.schedulers ?? [],
  };
}

/**
 * What ComfyUI has for a drawing preset's family and the files it chose: null for a checkpoint preset or one with a
 * workflow of its own, and while ComfyUI hasn't answered (or can't be asked).
 */
export function drawPresetFamily(models: EditModels, preset: DrawPreset): FamilyCheck | null {
  if (models.state !== "done" || !usesFamily(preset)) return null;
  return familyPresetCheck(models.families, preset);
}

/**
 * What ComfyUI has for IP-Adapter for a drawing preset's model base: null for a preset of a model family, and while
 * ComfyUI hasn't answered (or can't be asked).
 */
export function drawPresetIpAdapter(models: EditModels, preset: DrawPreset): IpAdapterCheck | null {
  if (models.state !== "done" || preset.family !== "checkpoint") return null;
  const base = baseOf(preset);
  return models.ipAdapters.find((c) => c.base === base) ?? null;
}
