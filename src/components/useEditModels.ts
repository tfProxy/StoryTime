"use client";

import { useEffect, useState } from "react";
import { forgetEditModels, modelChecksFor } from "@/lib/comfy/check";
import { familyPresetCheck, type FamilyCheck } from "@/lib/comfy/drawModels";
import { baseOf, type IpAdapterCheck } from "@/lib/comfy/ipAdapter";
import { editPresetCheck, type EditCheck } from "@/lib/comfy/editModels";
import { usesFamily, type DrawPreset, type EditPreset } from "@/lib/comfy/presets";

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

/**
 * Which edit models the ComfyUI machine can run, asked once per address. With `fresh` (a number), ComfyUI
 * is asked again rather than remembering an earlier answer, and again each time the number changes, as
 * Settings does after each setup check, so files added since then show up.
 */
export function useEditModels(url: string, fresh?: number): EditModels {
  const [found, setFound] = useState<{ url: string; fresh?: number; result: EditModels } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    if (fresh !== undefined) forgetEditModels();
    modelChecksFor(url).then(
      ({ edits: checks, families, ipAdapters }) =>
        live &&
        setFound({
          url,
          fresh,
          result: {
            state: "done",
            ready: checks.filter((c) => c.ready),
            checks,
            families,
            ipAdapters,
            loras: checks[0]?.loras ?? [],
            samplers: checks[0]?.samplers ?? [],
            schedulers: checks[0]?.schedulers ?? [],
          },
        }),
      (e) => live && setFound({ url, fresh, result: { state: "error", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [url, fresh]);
  // An earlier answer stays shown while ComfyUI is asked again.
  return found?.url === url ? found.result : { state: "checking" };
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

/** The edit presets ComfyUI can run now, each with its check (the files it uses); empty until ComfyUI has answered. */
export function usableEditPresets(models: EditModels, presets: EditPreset[]): { preset: EditPreset; check: EditCheck }[] {
  if (models.state !== "done") return [];
  return presets.flatMap((preset) => {
    const check = editPresetCheck(models.checks, preset);
    return check?.ready ? [{ preset, check }] : [];
  });
}

/** Why pictures can't be edited by instruction now, or null when they can (some edit preset can be used). */
export function editBlocked(models: EditModels, presets: EditPreset[]): string | null {
  if (models.state === "checking") return "Checking which edit models ComfyUI has…";
  if (models.state === "error") return `Couldn't check ComfyUI's edit models: ${models.message}`;
  if (usableEditPresets(models, presets).length === 0) {
    return "No edit model is installed in ComfyUI. Check setup in Settings (Qwen edit or Flux edit tab) says what is missing.";
  }
  return null;
}
