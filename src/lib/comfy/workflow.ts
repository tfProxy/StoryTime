// ComfyUI workflows in "API format": an object of nodes keyed by id, each { class_type, inputs }.
// An input is a value, or a link [nodeId, outputIndex] to another node. Pure code, no network.
//
// A workflow gets the picture's settings in one of two ways:
// - placeholders: any input that is exactly "{{seed}}", "{{width}}", "{{height}}" or "{{count}}"
//   becomes that number, and "{{prompt}}", "{{negative}}" and "{{checkpoint}}" are replaced inside
//   any text input;
// - or, when there are no placeholders, the usual nodes are found and filled in: the checkpoint
//   loader, the empty latent image, the sampler's seed, and the text encoders feeding the sampler.

export type WorkflowNode = { class_type: string; inputs: Record<string, unknown>; _meta?: unknown };
export type Workflow = Record<string, WorkflowNode>;

export type PictureParams = {
  prompt: string;
  negative: string;
  checkpoint: string;
  width: number;
  height: number;
  count: number;
  seed: number;
};

/** What a workflow lets StoryTime set, for showing in Settings. */
export type WorkflowFit = {
  mode: "builtin" | "placeholders" | "detected";
  prompt: boolean;
  negative: boolean;
  checkpoint: boolean;
  size: boolean;
  count: boolean;
  seed: boolean;
};

/** Text-to-image with an SDXL checkpoint: 30 steps of DPM++ 2M Karras at CFG 6. */
export const BUILTIN_WORKFLOW: Workflow = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: "{{seed}}", steps: 30, cfg: 6, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{checkpoint}}" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: "{{count}}" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "{{negative}}", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "StoryTime", images: ["8", 0] } },
};

export class WorkflowError extends Error {}

/** Reads a workflow pasted into Settings; "" means the built-in one. Throws WorkflowError explaining what is wrong. */
export function parseWorkflow(text: string): Workflow {
  if (!text.trim()) return BUILTIN_WORKFLOW;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowError("The workflow isn't valid JSON. In ComfyUI, use Workflow › Export (API) and paste the whole file.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("The workflow should be a JSON object of nodes.");
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
    throw new WorkflowError("That is ComfyUI's regular workflow file. StoryTime needs the API format: in ComfyUI, use Workflow › Export (API).");
  }
  const nodes = Object.entries(obj);
  if (nodes.length === 0) throw new WorkflowError("The workflow has no nodes.");
  for (const [id, n] of nodes) {
    const node = n as Partial<WorkflowNode> | null;
    if (!node || typeof node !== "object" || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") {
      throw new WorkflowError(`Node ${id} in the workflow has no class_type or inputs; is this the API format?`);
    }
  }
  return obj as Workflow;
}

const NUMBER_SLOTS = { "{{seed}}": "seed", "{{width}}": "width", "{{height}}": "height", "{{count}}": "count" } as const;
const TEXT_SLOTS = { "{{prompt}}": "prompt", "{{negative}}": "negative", "{{checkpoint}}": "checkpoint" } as const;

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

function placeholdersIn(wf: Workflow): Set<string> {
  const found = new Set<string>();
  for (const node of Object.values(wf)) {
    for (const v of Object.values(node.inputs)) {
      if (typeof v !== "string") continue;
      for (const key of [...Object.keys(NUMBER_SLOTS), ...Object.keys(TEXT_SLOTS)]) if (v.includes(key)) found.add(key);
    }
  }
  return found;
}

const SAMPLERS = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced)$/;
const LATENTS = /^Empty.*LatentImage$/;
const SEED_INPUTS = ["seed", "noise_seed"];

/** The text-encoder node a conditioning input ends up at, following links back through other nodes. */
function textEncoderFor(wf: Workflow, link: unknown, seen = new Set<string>()): string | null {
  if (!isLink(link) || seen.has(link[0])) return null;
  seen.add(link[0]);
  const node = wf[link[0]];
  if (!node) return null;
  if (/TextEncode/.test(node.class_type)) return link[0];
  // Pass through nodes like FluxGuidance or ConditioningCombine, and guiders (BasicGuider, CFGGuider).
  for (const key of ["conditioning", "positive", "conditioning_1", "guider"]) {
    const next = textEncoderFor(wf, node.inputs[key], seen);
    if (next) return next;
  }
  return null;
}

/** The positive and negative prompt nodes, found from the samplers (and guiders) in the workflow. */
function promptNodes(wf: Workflow): { positive: string | null; negative: string | null } {
  let positive: string | null = null;
  let negative: string | null = null;
  for (const node of Object.values(wf)) {
    if (!SAMPLERS.test(node.class_type) && !/Guider$/.test(node.class_type)) continue;
    positive ??= textEncoderFor(wf, node.inputs.positive) ?? textEncoderFor(wf, node.inputs.conditioning) ?? textEncoderFor(wf, node.inputs.guider);
    negative ??= textEncoderFor(wf, node.inputs.negative);
  }
  return { positive, negative: negative === positive ? null : negative };
}

/** What the workflow lets StoryTime set. */
export function describeWorkflow(wf: Workflow): WorkflowFit {
  if (wf === BUILTIN_WORKFLOW) return { mode: "builtin", prompt: true, negative: true, checkpoint: true, size: true, count: true, seed: true };
  const found = placeholdersIn(wf);
  if (found.size > 0) {
    return {
      mode: "placeholders",
      prompt: found.has("{{prompt}}"),
      negative: found.has("{{negative}}"),
      checkpoint: found.has("{{checkpoint}}"),
      size: found.has("{{width}}") && found.has("{{height}}"),
      count: found.has("{{count}}"),
      seed: found.has("{{seed}}"),
    };
  }
  const nodes = Object.values(wf);
  const { positive, negative } = promptNodes(wf);
  return {
    mode: "detected",
    prompt: positive !== null,
    negative: negative !== null,
    checkpoint: nodes.some((n) => n.class_type === "CheckpointLoaderSimple"),
    size: nodes.some((n) => LATENTS.test(n.class_type)),
    count: nodes.some((n) => LATENTS.test(n.class_type)),
    seed: nodes.some((n) => SEED_INPUTS.some((k) => typeof n.inputs[k] === "number")),
  };
}

/** A copy of the workflow with the picture's settings filled in. Throws WorkflowError if the prompt has nowhere to go. */
export function fillWorkflow(wf: Workflow, p: PictureParams): Workflow {
  const out: Workflow = JSON.parse(JSON.stringify(wf));
  if (placeholdersIn(out).size > 0) {
    if (!placeholdersIn(out).has("{{prompt}}")) throw new WorkflowError("The workflow has placeholders but no {{prompt}}, so the prompt has nowhere to go.");
    for (const node of Object.values(out)) {
      for (const [k, v] of Object.entries(node.inputs)) {
        if (typeof v !== "string") continue;
        if (v in NUMBER_SLOTS) node.inputs[k] = p[NUMBER_SLOTS[v as keyof typeof NUMBER_SLOTS]];
        else node.inputs[k] = v.replace(/\{\{(prompt|negative|checkpoint)\}\}/g, (_, key: "prompt" | "negative" | "checkpoint") => p[key]);
      }
    }
    return out;
  }

  const { positive, negative } = promptNodes(out);
  if (!positive) {
    throw new WorkflowError("Couldn't find where the prompt goes in the workflow. Put {{prompt}} in the positive prompt's text and export it again.");
  }
  const setText = (id: string, text: string) => {
    const inputs = out[id].inputs;
    for (const key of ["text", "text_g", "text_l", "clip_l", "t5xxl"]) if (typeof inputs[key] === "string") inputs[key] = text;
  };
  setText(positive, p.prompt);
  if (negative) setText(negative, p.negative);
  for (const node of Object.values(out)) {
    if (node.class_type === "CheckpointLoaderSimple" && p.checkpoint) node.inputs.ckpt_name = p.checkpoint;
    if (LATENTS.test(node.class_type)) {
      node.inputs.width = p.width;
      node.inputs.height = p.height;
      node.inputs.batch_size = p.count;
    }
    for (const k of SEED_INPUTS) if (typeof node.inputs[k] === "number") node.inputs[k] = p.seed;
  }
  return out;
}

/** A random seed in the range ComfyUI accepts (kept below 2^48 so it stays exact in JavaScript). */
export const randomSeed = () => Math.floor(Math.random() * 2 ** 48);
