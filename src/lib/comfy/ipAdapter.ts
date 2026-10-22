// IP-Adapter (the ComfyUI_IPAdapter_plus custom nodes), which lets a picture job take reference pictures: the
// model base of a drawing preset says which adapter and CLIP Vision files go with its checkpoint, and the
// setup check finds them in ComfyUI's /object_info. Pure code, no network.
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
