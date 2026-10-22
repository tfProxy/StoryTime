// Checks what the ComfyUI machine has installed: the checkpoints, what each drawing preset uses, and
// everything each edit model needs. Browser code: it asks ComfyUI directly, like the rest of the
// ComfyUI client.
import { comfyVersion, listCheckpoints, nodeInfo } from "./client";
import { checkDrawFamilies, DRAW_NODES, familyPresetCheck, type FamilyCheck } from "./drawModels";
import { checkEditModels, EDIT_NODES, type EditCheck } from "./editModels";
import { baseOf, checkIpAdapter, IPADAPTER_NODES, type IpAdapterCheck } from "./ipAdapter";
import { comboOptions } from "./modelParts";
import { usesFamily, type DrawPreset } from "./presets";
import { BUILTIN_INPAINT, BUILTIN_WORKFLOW, parseWorkflow, WorkflowError } from "./workflow";

/** What the check found for one drawing preset. */
export type DrawCheck = {
  preset: DrawPreset;
  /**
   * The files and nodes of a preset of a model family (Z-Image, Flux…) using the family's built-in workflow;
   * null for a checkpoint preset or one with a workflow of its own.
   */
  family: FamilyCheck | null;
  /** Nodes its workflow uses that ComfyUI doesn't have; null when the workflow can't be read. */
  missingNodes: string[] | null;
  /** Why its workflow can't be read, when it can't. */
  workflowError: string | null;
  /** Whether ComfyUI has its checkpoint (false when it has none chosen). */
  checkpoint: boolean;
  /** Its LoRAs switched on whose files ComfyUI doesn't list. */
  missingLoras: string[];
  /** Whether reference pictures (IP-Adapter) could be used with it; null for a preset of a model family. Informational: the preset works without. */
  ipAdapter: IpAdapterCheck | null;
};

export type ComfyCheck = {
  version: string;
  checkpoints: string[];
  draws: DrawCheck[];
  edits: EditCheck[];
};

/** The node a drawing preset's LoRAs are loaded with. */
const DRAW_LORA_LOADER = "LoraLoader";

/** The nodes a preset's workflow uses, or why it can't be read. A family's built-in workflow is checked by its family instead. */
function workflowNodes(p: DrawPreset): { nodes: string[] | null; error: string | null } {
  if (usesFamily(p)) return { nodes: [], error: null };
  try {
    const wf = parseWorkflow(p.workflow);
    const all = wf === BUILTIN_WORKFLOW ? { ...BUILTIN_WORKFLOW, ...BUILTIN_INPAINT } : wf;
    return { nodes: [...new Set(Object.values(all).map((n) => n.class_type))], error: null };
  } catch (e) {
    return { nodes: null, error: e instanceof WorkflowError ? e.message : String(e) };
  }
}

/** Everything the Settings check reports. Throws when ComfyUI can't be reached. */
export async function checkComfy(url: string, presets: DrawPreset[]): Promise<ComfyCheck> {
  const version = await comfyVersion(url);
  const read = presets.map((p) => ({ preset: p, ...workflowNodes(p) }));
  const asked = [...new Set([...EDIT_NODES, ...DRAW_NODES, DRAW_LORA_LOADER, ...IPADAPTER_NODES, ...read.flatMap((r) => r.nodes ?? [])])];
  const [checkpoints, info] = await Promise.all([listCheckpoints(url), nodeInfo(url, asked)]);
  forgetEditModels();
  const loras = comboOptions(info[DRAW_LORA_LOADER], "lora_name");
  const families = checkDrawFamilies(info);
  return {
    version,
    checkpoints,
    draws: read.map(({ preset, nodes, error }) => ({
      preset,
      family: usesFamily(preset) ? familyPresetCheck(families, preset) : null,
      missingNodes: nodes && nodes.filter((n) => !info[n]),
      workflowError: error,
      checkpoint: preset.checkpoint !== "" && checkpoints.includes(preset.checkpoint),
      missingLoras: preset.loras.filter((l) => l.on && l.name && !loras.includes(l.name)).map((l) => l.name),
      ipAdapter: preset.family === "checkpoint" ? checkIpAdapter(info, baseOf(preset)) : null,
    })),
    edits: checkEditModels(info),
  };
}

/** What ComfyUI has for the edit models and the drawing model families. */
export type ModelChecks = { edits: EditCheck[]; families: FamilyCheck[] };

// The Illustrate page asks once per ComfyUI address; the Settings check asks again.
const cache = new Map<string, Promise<ModelChecks>>();

/** Which edit models and drawing families ComfyUI can run. A failed check is asked again next time. */
export function modelChecksFor(url: string): Promise<ModelChecks> {
  let found = cache.get(url);
  if (!found) {
    found = nodeInfo(url, [...new Set([...EDIT_NODES, ...DRAW_NODES])]).then((info) => ({ edits: checkEditModels(info), families: checkDrawFamilies(info) }));
    found.catch(() => cache.delete(url));
    cache.set(url, found);
  }
  return found;
}

export function forgetEditModels() {
  cache.clear();
}
