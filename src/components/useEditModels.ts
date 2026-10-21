"use client";

import { useEffect, useState } from "react";
import { editModelsFor, forgetEditModels } from "@/lib/comfy/check";
import type { EditCheck } from "@/lib/comfy/editModels";

export type EditModels =
  | { state: "checking" }
  | {
      state: "done";
      /** The models ComfyUI can run, with the files to use. */
      ready: EditCheck[];
      /** Every LoRA file ComfyUI lists, for the author's LoRA stacks. */
      loras: string[];
      /** The samplers and schedulers ComfyUI offers, for Settings. */
      samplers: string[];
      schedulers: string[];
    }
  | { state: "error"; message: string };

/**
 * Which edit models the ComfyUI machine can run, asked once per address. With `fresh`, ComfyUI is asked
 * again rather than remembering an earlier answer, as Settings does, so files added since then show up.
 */
export function useEditModels(url: string, fresh = false): EditModels {
  const [found, setFound] = useState<{ url: string; result: EditModels } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    if (fresh) forgetEditModels();
    editModelsFor(url).then(
      (checks) =>
        live &&
        setFound({
          url,
          result: {
            state: "done",
            ready: checks.filter((c) => c.ready),
            loras: checks[0]?.loras ?? [],
            samplers: checks[0]?.samplers ?? [],
            schedulers: checks[0]?.schedulers ?? [],
          },
        }),
      (e) => live && setFound({ url, result: { state: "error", message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [url, fresh]);
  return found?.url === url ? found.result : { state: "checking" };
}

/** Why pictures can't be edited by instruction now, or null when they can. */
export function editBlocked(models: EditModels): string | null {
  if (models.state === "checking") return "Checking which edit models ComfyUI has…";
  if (models.state === "error") return `Couldn't check ComfyUI's edit models: ${models.message}`;
  if (models.ready.length === 0) return "No edit model is installed in ComfyUI. Check setup on the Pictures tab of Settings says what is missing.";
  return null;
}
