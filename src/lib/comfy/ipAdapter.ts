// IP-Adapter (the ComfyUI_IPAdapter_plus custom nodes), which lets a picture job take reference pictures: the
// model base of a drawing preset says which adapter and CLIP Vision files go with its checkpoint, and the
// setup check finds them in ComfyUI's /object_info. Pure code, no network.
import type { Workflow } from "./workflow";
import { findFile, partChoices, pickPart, type ModelPart, type NodeInfo, type PartCheck } from "./modelParts";

/** The kind of model a checkpoint is built on, which decides the IP-Adapter files it needs. */
export const MODEL_BASES = ["sdxl", "illustrious", "noobai", "pony"] as const;
export type ModelBase = (typeof MODEL_BASES)[number];

export const BASE_NAMES: Record<ModelBase, string> = { sdxl: "SDXL", illustrious: "Illustrious", noobai: "NoobAI", pony: "Pony" };

/** The base a checkpoint file's name suggests; SDXL when it says nothing. */
export function guessBase(checkpoint: string): ModelBase {
  if (/noob/i.test(checkpoint)) return "noobai";
  if (/illustrious|illu\b|ilxl/i.test(checkpoint)) return "illustrious";
  if (/pony|pdxl/i.test(checkpoint)) return "pony";
  return "sdxl";
}

/** A preset's model base: the one chosen, else guessed from its checkpoint's name. */
export const baseOf = (p: { base?: ModelBase; checkpoint: string }): ModelBase => p.base ?? guessBase(p.checkpoint);

/** The nodes reference pictures need: the first two come from ComfyUI_IPAdapter_plus, the last is ComfyUI's own. */
export const IPADAPTER_NODES = ["IPAdapterModelLoader", "IPAdapterAdvanced", "CLIPVisionLoader"] as const;

/** The adapter and CLIP Vision files that go with SDXL and Pony checkpoints. */
const SDXL_ADAPTER: ModelPart = {
  key: "ipAdapter", label: "IP-Adapter model", folder: "ipadapter", loader: "IPAdapterModelLoader", input: "ipadapter_file",
  recommended: "ip-adapter-plus_sdxl_vit-h.safetensors", match: /ip[-_]?adapter[-_]?plus[-_]?sdxl[-_]?vit[-_]?h/i, output: 0,
};
const SDXL_CLIP_VISION: ModelPart = {
  key: "clipVision", label: "CLIP Vision model", folder: "clip_vision", loader: "CLIPVisionLoader", input: "clip_name",
  recommended: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors", match: /vit[-_]?h[-_]?14|clip[-_]?vit[-_]?h/i, output: 0,
};
/** The ones that go with NoobAI and Illustrious checkpoints (Laxhar's noob_ipa). */
const NOOB_ADAPTER: ModelPart = {
  key: "ipAdapter", label: "IP-Adapter model", folder: "ipadapter", loader: "IPAdapterModelLoader", input: "ipadapter_file",
  recommended: "noobIPAMARK1_mark1.safetensors", match: /noob.*ipa|ipa.*noob/i, output: 0,
};
const NOOB_CLIP_VISION: ModelPart = {
  key: "clipVision", label: "CLIP Vision model", folder: "clip_vision", loader: "CLIPVisionLoader", input: "clip_name",
  recommended: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors", match: /vit[-_]?bigg|bigg[-_]?14/i, output: 0,
};

/** The two files each base needs: the adapter, then the CLIP Vision model. */
export const IPADAPTER_PARTS: Record<ModelBase, ModelPart[]> = {
  sdxl: [SDXL_ADAPTER, SDXL_CLIP_VISION],
  pony: [SDXL_ADAPTER, SDXL_CLIP_VISION],
  noobai: [NOOB_ADAPTER, NOOB_CLIP_VISION],
  illustrious: [NOOB_ADAPTER, NOOB_CLIP_VISION],
};

/** What the check found for one base. */
export type IpAdapterCheck = {
  base: ModelBase;
  /** Nodes of IPADAPTER_NODES that ComfyUI doesn't have. */
  missingNodes: string[];
  parts: PartCheck[];
  /** The file used for each part, by part key (only the ones found). */
  files: Record<string, string>;
  /** Whether the nodes and both files are there. */
  ready: boolean;
};

/** The node info the check needs: IPADAPTER_NODES, as nodeInfo() of the client returns them. */
export function checkIpAdapter(info: Record<string, NodeInfo>, base: ModelBase, chosenFiles: Record<string, string> = {}): IpAdapterCheck {
  const missingNodes = IPADAPTER_NODES.filter((n) => !info[n]);
  const parts = IPADAPTER_PARTS[base].map((part) => {
    const choices = partChoices(part, info);
    return chosenFiles[part.key] ? pickPart(part, choices, chosenFiles[part.key]) : { part, choices, file: findFile(part, choices) };
  });
  const files = Object.fromEntries(parts.flatMap((p) => (p.file ? [[p.part.key, p.file]] : [])));
  return { base, missingNodes: [...missingNodes], parts, files, ready: missingNodes.length === 0 && parts.every((p) => p.file !== null) };
}

/** What is wrong with using references with this check, or null when IP-Adapter is ready. */
export function ipAdapterProblem(check: IpAdapterCheck | null): string | null {
  if (!check) return "StoryTime hasn't found out yet which IP-Adapter files ComfyUI has. Try again in a moment.";
  if (check.ready) return null;
  const missing = [
    ...(check.missingNodes.length ? [`the custom nodes ${check.missingNodes.join(", ")} (install ComfyUI_IPAdapter_plus)`] : []),
    ...check.parts.filter((p) => p.file === null).map((p) => `${p.part.label} (${p.part.recommended})`),
  ];
  return `Reference pictures need IP-Adapter, and ComfyUI is missing ${missing.join(" and ")}. Settings › Drawing has the details.`;
}

/** One reference picture for `withReferences`: its name in ComfyUI's input folder, what it shows and how strongly to follow it. */
export type RefInput = { image: string; role: "character" | "item" | "place" | "style"; weight: number };

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/** The samplers whose model the references are put in front of. */
const MODEL_SAMPLERS = /^(KSampler|KSamplerAdvanced)$/;

/**
 * A copy of the workflow whose samplers take their model through IP-Adapter, one `IPAdapterAdvanced` per
 * reference, chained after the model the samplers had (a LoRA's, say). `files` are the adapter's and the CLIP
 * Vision model's file names. A style reference is followed as "style transfer" for the whole run; the others
 * stop at 0.8 so the prompt can still shape the last steps. Throws an Error when no sampler has a model to wrap.
 */
export function withReferences(workflow: Workflow, refs: RefInput[], files: { ipadapter: string; clipVision: string }): Workflow {
  const out: Workflow = JSON.parse(JSON.stringify(workflow));
  if (refs.length === 0) return out;
  const samplers = Object.values(out).filter((n) => MODEL_SAMPLERS.test(n.class_type) && isLink(n.inputs.model));
  if (samplers.length === 0) throw new Error("Couldn't find the sampler's model in the workflow, so there is nowhere to put the reference pictures.");
  let model = samplers[0].inputs.model as [string, number];
  out["ref-loader"] = { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: files.ipadapter } };
  out["ref-clip-vision"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: files.clipVision } };
  refs.forEach((r, i) => {
    const n = i + 1;
    const style = r.role === "style";
    out[`ref-${n}-image`] = { class_type: "LoadImage", inputs: { image: r.image } };
    out[`ref-${n}`] = {
      class_type: "IPAdapterAdvanced",
      inputs: {
        model,
        ipadapter: ["ref-loader", 0],
        image: [`ref-${n}-image`, 0],
        clip_vision: ["ref-clip-vision", 0],
        weight: r.weight,
        weight_type: style ? "style transfer" : "linear",
        combine_embeds: "concat",
        start_at: 0,
        end_at: style ? 1 : 0.8,
        embeds_scaling: "V only",
      },
    };
    model = [`ref-${n}`, 0];
  });
  for (const s of samplers) s.inputs.model = model;
  return out;
}
