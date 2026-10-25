"use client";

import { useEffect, useState } from "react";
import { forgetEditModels, modelChecksFor } from "@/lib/comfy/check";
import { toEditModels, type EditModels } from "@/lib/comfy/editModelsData";
import { editPresetCheck, type EditCheck } from "@/lib/comfy/editModels";
import { type EditPreset } from "@/lib/comfy/presets";

// The pure parts live in `lib/comfy/editModelsData` (the server uses them too); re-exported so imports here keep working.
export { drawPresetFamily, drawPresetIpAdapter, toEditModels, type EditModels } from "@/lib/comfy/editModelsData";

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
      (found) => live && setFound({ url, fresh, result: toEditModels(found) }),
      (e) => live && setFound({ url, fresh, result: { state: "error", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [url, fresh]);
  // An earlier answer stays shown while ComfyUI is asked again.
  return found?.url === url ? found.result : { state: "checking" };
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
