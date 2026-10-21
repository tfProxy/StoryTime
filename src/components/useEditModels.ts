"use client";

import { useEffect, useState } from "react";
import { editModelsFor } from "@/lib/comfy/check";
import type { EditCheck } from "@/lib/comfy/editModels";

export type EditModels =
  | { state: "checking" }
  | {
      state: "done";
      /** The models ComfyUI can run, with the files to use. */
      ready: EditCheck[];
      /** Every LoRA file ComfyUI lists, for the author's LoRA stacks. */
      loras: string[];
    }
  | { state: "error"; message: string };

/** Which edit models the ComfyUI machine can run, asked once per address. */
export function useEditModels(url: string): EditModels {
  const [found, setFound] = useState<{ url: string; result: EditModels } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    editModelsFor(url).then(
      (checks) => live && setFound({ url, result: { state: "done", ready: checks.filter((c) => c.ready), loras: checks[0]?.loras ?? [] } }),
      (e) => live && setFound({ url, result: { state: "error", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return found?.url === url ? found.result : { state: "checking" };
}

/** Why pictures can't be edited by instruction now, or null when they can. */
export function editBlocked(models: EditModels): string | null {
  if (models.state === "checking") return "Checking which edit models ComfyUI has…";
  if (models.state === "error") return `Couldn't check ComfyUI's edit models: ${models.message}`;
  if (models.ready.length === 0) return "No edit model is installed in ComfyUI. Settings › Pictures › Check setup says what is missing.";
  return null;
}
