// Checks what the ComfyUI machine has installed: the checkpoints, what each drawing preset uses, and
// everything each edit model needs. Browser code: it asks ComfyUI directly, like the rest of the
// ComfyUI client.
import { comfyVersion, listCheckpoints, nodeInfo } from "./client";
import { checkEditModels, comboOptions, EDIT_NODES, type EditCheck } from "./editModels";
import type { DrawPreset } from "./presets";
import { BUILTIN_IMG2IMG, BUILTIN_WORKFLOW, parseWorkflow, WorkflowError } from "./workflow";

/** What the check found for one drawing preset. */
export type DrawCheck = {
  preset: DrawPreset;
  /** Nodes its workflow uses that ComfyUI doesn't have; null when the workflow can't be read. */
  missingNodes: string[] | null;
  /** Why its workflow can't be read, when it can't. */
  workflowError: string | null;
  /** Whether ComfyUI has its checkpoint (false when it has none chosen). */
  checkpoint: boolean;
  /** Its LoRAs switched on whose files ComfyUI doesn't list. */
  missingLoras: string[];
};

export type ComfyCheck = {
  version: string;
  checkpoints: string[];
  draws: DrawCheck[];
  edits: EditCheck[];
};

/** The node a drawing preset's LoRAs are loaded with. */
const DRAW_LORA_LOADER = "LoraLoader";

/** The nodes a preset's workflow uses, or why it can't be read. */
function workflowNodes(text: string): { nodes: string[] | null; error: string | null } {
  try {
    const wf = parseWorkflow(text);
    const all = wf === BUILTIN_WORKFLOW ? { ...BUILTIN_WORKFLOW, ...BUILTIN_IMG2IMG } : wf;
    return { nodes: [...new Set(Object.values(all).map((n) => n.class_type))], error: null };
  } catch (e) {
    return { nodes: null, error: e instanceof WorkflowError ? e.message : String(e) };
  }
}

/** Everything the Settings check reports. Throws when ComfyUI can't be reached. */
export async function checkComfy(url: string, presets: DrawPreset[]): Promise<ComfyCheck> {
  const version = await comfyVersion(url);
  const read = presets.map((p) => ({ preset: p, ...workflowNodes(p.workflow) }));
  const asked = [...new Set([...EDIT_NODES, DRAW_LORA_LOADER, ...read.flatMap((r) => r.nodes ?? [])])];
  const [checkpoints, info] = await Promise.all([listCheckpoints(url), nodeInfo(url, asked)]);
  forgetEditModels();
  const loras = comboOptions(info[DRAW_LORA_LOADER], "lora_name");
  return {
    version,
    checkpoints,
    draws: read.map(({ preset, nodes, error }) => ({
      preset,
      missingNodes: nodes && nodes.filter((n) => !info[n]),
      workflowError: error,
      checkpoint: preset.checkpoint !== "" && checkpoints.includes(preset.checkpoint),
      missingLoras: preset.loras.filter((l) => l.on && l.name && !loras.includes(l.name)).map((l) => l.name),
    })),
    edits: checkEditModels(info),
  };
}

// The Illustrate page asks once per ComfyUI address; the Settings check asks again.
const cache = new Map<string, Promise<EditCheck[]>>();

/** Which edit models ComfyUI can run. A failed check is asked again next time. */
export function editModelsFor(url: string): Promise<EditCheck[]> {
  let found = cache.get(url);
  if (!found) {
    found = nodeInfo(url, EDIT_NODES).then(checkEditModels);
    found.catch(() => cache.delete(url));
    cache.set(url, found);
  }
  return found;
}

export function forgetEditModels() {
  cache.clear();
}
