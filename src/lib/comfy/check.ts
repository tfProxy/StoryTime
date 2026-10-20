// Checks what the ComfyUI machine has installed: the checkpoints, the nodes the picture workflow uses,
// and everything each edit model needs. Browser code: it asks ComfyUI directly, like the rest of the
// ComfyUI client.
import { comfyVersion, listCheckpoints, nodeInfo } from "./client";
import { checkEditModels, EDIT_NODES, type EditCheck } from "./editModels";
import { BUILTIN_IMG2IMG, BUILTIN_WORKFLOW, parseWorkflow, WorkflowError } from "./workflow";

export type ComfyCheck = {
  version: string;
  checkpoints: string[];
  /** Nodes the picture workflow uses that ComfyUI doesn't have; null when the workflow can't be read. */
  missingNodes: string[] | null;
  /** Why the workflow can't be read, when it can't. */
  workflowError: string | null;
  edits: EditCheck[];
};

/** Everything the Settings check reports. Throws when ComfyUI can't be reached. */
export async function checkComfy(url: string, workflowText: string): Promise<ComfyCheck> {
  const version = await comfyVersion(url);
  let workflowNodes: string[] | null = null;
  let workflowError: string | null = null;
  try {
    const wf = parseWorkflow(workflowText);
    const all = wf === BUILTIN_WORKFLOW ? { ...BUILTIN_WORKFLOW, ...BUILTIN_IMG2IMG } : wf;
    workflowNodes = [...new Set(Object.values(all).map((n) => n.class_type))];
  } catch (e) {
    workflowError = e instanceof WorkflowError ? e.message : String(e);
  }
  const [checkpoints, info] = await Promise.all([listCheckpoints(url), nodeInfo(url, [...new Set([...EDIT_NODES, ...(workflowNodes ?? [])])])]);
  forgetEditModels();
  return {
    version,
    checkpoints,
    missingNodes: workflowNodes && workflowNodes.filter((n) => !info[n]),
    workflowError,
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
