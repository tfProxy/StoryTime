// The newer drawing models (Z-Image, Flux, Chroma, Qwen-Image): what the check finds in ComfyUI's /object_info,
// the workflows built from it, and the drawing preset's summary. Pure logic, no server.
import {
  buildDraw, checkDrawFamilies, DRAW_FAMILIES, DRAW_MODELS, DRAW_NODES, drawKnobs, drawModel, drawTuning, familyPresetCheck, familyProblems, ggufNeeded,
  type DrawParams, type FamilyCheck,
} from "../../src/lib/comfy/drawModels.ts";
import { checkEditModels } from "../../src/lib/comfy/editModels.ts";
import { drawPresetSummary, newDrawPreset, usesFamily } from "../../src/lib/comfy/presets.ts";
import { parseSettings } from "../../src/lib/settingsSchema.ts";
import type { NodeInfo } from "../../src/lib/comfy/modelParts.ts";
import { stepsToRun, type Workflow } from "../../src/lib/comfy/workflow.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

type Files = { unet?: string[]; clip?: string[]; vae?: string[] };
const TYPES = ["stable_diffusion", "sd3", "qwen_image", "lumina2", "chroma", "krea2"];

/**
 * What ComfyUI says about every node the check asks about. `gguf` adds ComfyUI-GGUF's loaders (which list every
 * file, the ordinary loaders only the others); `types` is what the CLIPLoaders offer; `missing` lists nodes ComfyUI lacks;
 * `tokenizer` adds T5TokenizerOptions.
 */
function info(files: Files, o: { gguf?: boolean; types?: string[]; missing?: string[]; tokenizer?: boolean; ggufDevice?: boolean } = {}): Record<string, NodeInfo> {
  const plain = (xs: string[] = []) => (o.gguf ? xs.filter((x) => !x.endsWith(".gguf")) : xs);
  const types = o.types ?? TYPES;
  const device = { device: [["default", "cpu"], {}] };
  const nodes: Record<string, NodeInfo> = {
    UNETLoader: { input: { required: { unet_name: [plain(files.unet), {}], weight_dtype: [["default"], {}] } } },
    CLIPLoader: { input: { required: { clip_name: [plain(files.clip), {}], type: [types, {}] }, optional: device } },
    DualCLIPLoader: { input: { required: { clip_name1: ["COMBO", { options: plain(files.clip) }], clip_name2: ["COMBO", { options: plain(files.clip) }], type: ["COMBO", { options: ["flux", "sdxl"] }] }, optional: device } },
    VAELoader: { input: { required: { vae_name: [files.vae ?? [], {}] } } },
  };
  if (o.gguf) {
    nodes.UnetLoaderGGUF = { input: { required: { unet_name: [files.unet ?? [], {}] } } };
    nodes.CLIPLoaderGGUF = { input: { required: { clip_name: [files.clip ?? [], {}], type: [types, {}] }, optional: o.ggufDevice ? device : {} } };
    nodes.DualCLIPLoaderGGUF = { input: { required: { clip_name1: ["COMBO", { options: files.clip ?? [] }], clip_name2: ["COMBO", { options: files.clip ?? [] }], type: ["COMBO", { options: ["flux"] }] } } };
  }
  if (o.tokenizer) nodes.T5TokenizerOptions = { input: { required: {} } };
  return Object.fromEntries(DRAW_NODES.map((n) => [n, (o.missing ?? []).includes(n) ? null : (nodes[n] ?? (n.endsWith("GGUF") || n === "T5TokenizerOptions" ? null : { input: { required: {} } }))]));
}

const byId = (checks: FamilyCheck[], id: string) => checks.find((c) => c.model.id === id)!;
const nodesOfType = (wf: Workflow, type: string) => Object.entries(wf).filter(([, n]) => n.class_type === type);
const only = (wf: Workflow, type: string) => nodesOfType(wf, type)[0]?.[1];
const idOf = (wf: Workflow, type: string) => nodesOfType(wf, type)[0]?.[0];
/** The sampler: a KSampler, or a KSamplerAdvanced when a redraw runs only part of its steps. */
const sampler = (wf: Workflow) => only(wf, "KSampler") ?? only(wf, "KSamplerAdvanced");
/** The node a link points to. */
const target = (wf: Workflow, link: unknown) => (Array.isArray(link) ? wf[String(link[0])] : undefined);

const P: DrawParams = { prompt: "a fox in a forest", negative: "blurry", seed: 7, count: 2, width: 832, height: 1216, prefix: "StoryTime/s/c" };

// ---- the settings: families, and old presets ----
ok(DRAW_FAMILIES[0] === "checkpoint" && DRAW_MODELS.every((m) => DRAW_FAMILIES.includes(m.id)) && DRAW_FAMILIES.length === DRAW_MODELS.length + 1, "every model family is a choice of the Model type menu, after checkpoint");
ok(DRAW_MODELS.every((m) => !m.nodes.some((n) => n.includes("GGUF"))), "no family needs the GGUF nodes to be ready");

// An old preset (saved before families) is a checkpoint preset; a new one keeps its family and files.
const oldPreset = { id: "p", name: "Old", promptStyle: "tags", prompt: "", negative: "", checkpoint: "sdxl.safetensors", workflow: "", loras: [], sampler: { steps: 20 }, denoise: 0.5 };
const parsed = (preset: unknown) => parseSettings({ comfy: { url: "http://x", drawPresets: [preset] } }).comfy.drawPresets[0];
let p = parsed(oldPreset);
ok(p.family === "checkpoint" && p.checkpoint === "sdxl.safetensors" && p.textEncoderDevice === "default" && Object.keys(p.files).length === 0, "a drawing preset from before families parses as a checkpoint preset");
ok(p.sampler.steps === 20, "…keeping its sampler settings");
ok(parsed({ ...oldPreset, family: "poetry" }).family === "checkpoint", "an unknown family falls back to checkpoint");
p = parsed({ ...oldPreset, family: "zimage", files: { model: "z.gguf", textEncoder: "q.gguf", bogus: "x", vae: 3 }, textEncoderDevice: "cpu", sampler: { shift: 4, guidance: 99, cfg: 2 } });
ok(p.family === "zimage" && p.files.model === "z.gguf" && p.files.textEncoder === "q.gguf" && !("bogus" in p.files) && !("vae" in p.files) && p.textEncoderDevice === "cpu", "a family preset keeps the files it chose (known parts only) and the text encoder device");
ok(p.sampler.shift === 4 && p.sampler.guidance === undefined && p.sampler.cfg === 2, "…and the family settings, dropping one out of range");
ok(newDrawPreset("a", "A").family === "checkpoint" && usesFamily({ family: "zimage", workflow: "" }) && !usesFamily({ family: "zimage", workflow: "{}" }) && !usesFamily({ family: "checkpoint", workflow: "" }), "a pasted workflow overrides a family; a checkpoint preset never uses one");

// ---- Z-Image ----
const zFiles: Files = { unet: ["z_image_turbo_bf16.safetensors", "flux1-dev-fp8.safetensors", "qwen_image_fp8_e4m3fn.safetensors"], clip: ["qwen_3_4b.safetensors", "qwen_2.5_vl_7b_fp8_scaled.safetensors", "clip_l.safetensors"], vae: ["ae.safetensors", "qwen_image_vae.safetensors"] };
let checks = checkDrawFamilies(info(zFiles));
let z = byId(checks, "zimage");
ok(z.ready && z.files.model === "z_image_turbo_bf16.safetensors" && z.files.textEncoder === "qwen_3_4b.safetensors" && z.files.vae === "ae.safetensors", "Z-Image: every file is found by its name, among other models' files");
ok(familyProblems(z).length === 0, "…and a ready family has no problems to report");
ok(!byId(checkDrawFamilies(info({ ...zFiles, unet: ["flux1-dev-fp8.safetensors"] })), "zimage").ready, "…and without its model it isn't ready");
z = byId(checkDrawFamilies(info({ ...zFiles, unet: ["sub/Z-Image-Turbo_fp8.safetensors"], vae: ["flux/ae.safetensors"], clip: ["Qwen3-4B.safetensors"] })), "zimage");
ok(z.ready && z.files.model === "sub/Z-Image-Turbo_fp8.safetensors" && z.files.textEncoder === "Qwen3-4B.safetensors", "…other names are found too (a Civitai fine-tune, a subfolder)");

let wf = buildDraw(z, P);
const ids = (w: Workflow) => Object.keys(w).sort();
ok(wf["1"].class_type === "UNETLoader" && wf["2"].class_type === "CLIPLoader" && wf["3"].class_type === "VAELoader", "Z-Image: the model, text encoder and VAE are nodes 1, 2 and 3");
ok(wf["2"].inputs.type === "lumina2" && wf["2"].inputs.device === "default" && wf["2"].inputs.clip_name === z.files.textEncoder, "…the text encoder is a lumina2 CLIPLoader");
let ks = only(wf, "KSampler");
ok(ks.inputs.steps === 9 && ks.inputs.cfg === 1 && ks.inputs.sampler_name === "res_multistep" && ks.inputs.scheduler === "simple" && ks.inputs.denoise === 1 && ks.inputs.seed === 7, "…the sampler is 9 steps of res_multistep simple at CFG 1");
ok(only(wf, "ModelSamplingAuraFlow").inputs.shift === 3 && target(wf, ks.inputs.model)?.class_type === "ModelSamplingAuraFlow" && target(wf, only(wf, "ModelSamplingAuraFlow").inputs.model)?.class_type === "UNETLoader", "…the model goes through ModelSamplingAuraFlow, shift 3");
const pos = target(wf, ks.inputs.positive), neg = target(wf, ks.inputs.negative);
ok(pos?.class_type === "CLIPTextEncode" && pos.inputs.text === P.prompt && neg?.class_type === "ConditioningZeroOut" && target(wf, neg.inputs.conditioning) === pos, "…the negative is the positive prompt zeroed out (the negative prompt is unused)");
const latent = only(wf, "EmptySD3LatentImage");
ok(latent.inputs.width === 832 && latent.inputs.height === 1216 && latent.inputs.batch_size === 2 && target(wf, ks.inputs.latent_image) === latent, "…the latent is an EmptySD3LatentImage of the size and count");
ok(only(wf, "SaveImage").inputs.filename_prefix === P.prefix && target(wf, only(wf, "VAEDecode").inputs.samples) === ks, "…the pictures are decoded and saved under the prefix");
ok(ids(wf).join() === ids(buildDraw(z, P)).join() && JSON.stringify(wf).includes("a fox in a forest"), "…building twice gives the same nodes");

// Redraw from a picture
wf = buildDraw(z, { ...P, image: "start.png", denoise: 0.6, width: 1000, height: 1500 });
ks = sampler(wf);
const load = idOf(wf, "LoadImage"), scale = idOf(wf, "ImageScale"), enc = idOf(wf, "VAEEncode"), rep = idOf(wf, "RepeatLatentBatch");
ok(only(wf, "LoadImage").inputs.image === "start.png" && only(wf, "ImageScale").inputs.image[0] === load && only(wf, "VAEEncode").inputs.pixels[0] === scale && only(wf, "VAEEncode").inputs.vae[0] === "3" && only(wf, "RepeatLatentBatch").inputs.samples[0] === enc, "Redraw: LoadImage → ImageScale → VAEEncode → RepeatLatentBatch");
ok(ks.inputs.latent_image[0] === rep && only(wf, "RepeatLatentBatch").inputs.amount === 2 && nodesOfType(wf, "EmptySD3LatentImage").length === 0, "…the sampler starts from it, with no empty latent");
ok(wf["8"] === ks && ks === only(wf, "KSamplerAdvanced") && !only(wf, "KSampler") && ks.inputs.steps === 9 && ks.inputs.start_at_step === 9 - stepsToRun(9, 0.6) && ks.inputs.end_at_step === 10000 && ks.inputs.add_noise === "enable" && ks.inputs.return_with_leftover_noise === "disable" && ks.inputs.noise_seed === 7 && !("denoise" in ks.inputs) && wf["20"].inputs.samples[0] === "8", "…at the Redraw strength it runs only the steps that needs (a KSamplerAdvanced, still node 8)");
ok(only(buildDraw(z, { ...P, image: "start.png", denoise: 1 }), "KSampler").inputs.denoise === 1 && only(buildDraw(z, { ...P, denoise: 0.6 }), "KSampler").inputs.denoise === 1, "…at full strength, or with no picture, it stays a KSampler");
{
  const m = buildDraw(z, { ...P, image: "start.png", denoise: 0.6, mask: "mask.png" });
  const noise = only(m, "SetLatentNoiseMask");
  const paste = only(m, "ImageCompositeMasked");
  ok(only(m, "LoadImageMask").inputs.image === "mask.png" && noise.inputs.samples[0] === idOf(m, "RepeatLatentBatch") && sampler(m).inputs.latent_image[0] === idOf(m, "SetLatentNoiseMask"), "…with a painted area, the mask limits the sampler's latent");
  ok(paste.inputs.source[0] === idOf(m, "ImageScale") && paste.inputs.destination[0] === idOf(m, "VAEDecode") && only(m, "SaveImage").inputs.images[0] === idOf(m, "ImageCompositeMasked"), "…and the new pictures are pasted over the scaled picture outside it");
  ok(nodesOfType(buildDraw(z, { ...P, mask: "mask.png" }), "LoadImageMask").length === 0, "…a mask without a starting picture is ignored");
  // The sampled mask grows past the painted one; the model goes through Differential Diffusion.
  const g = buildDraw(z, { ...P, image: "start.png", denoise: 0.6, mask: "mask.png", grow: 13 });
  const grow = only(g, "GrowMask");
  const loader = idOf(g, "LoadImageMask");
  ok(nodesOfType(g, "GrowMask").length === 1 && grow.inputs.mask[0] === loader && grow.inputs.expand === 13 && grow.inputs.tapered_corners === true && only(g, "SetLatentNoiseMask").inputs.mask[0] === idOf(g, "GrowMask"), "…with a grow, a GrowMask sits between the mask loader and SetLatentNoiseMask");
  ok(target(g, only(g, "InvertMask").inputs.mask) === only(g, "LoadImageMask") && target(g, only(g, "ImageCompositeMasked").inputs.mask) === only(g, "InvertMask"), "…and the paste-back mask is still the inverted, un-grown one");
  const dd = target(g, sampler(g).inputs.model);
  ok(nodesOfType(g, "DifferentialDiffusion").length === 1 && dd === only(g, "DifferentialDiffusion") && target(g, dd?.inputs.model)?.class_type === "ModelSamplingAuraFlow", "…the sampler's model goes through DifferentialDiffusion");
  const gl = buildDraw(z, { ...P, image: "start.png", denoise: 0.6, mask: "mask.png", grow: 13, loras: [{ name: "a.safetensors", strength: 0.8 }] });
  ok(target(gl, target(gl, sampler(gl).inputs.model)?.inputs.model)?.class_type === "ModelSamplingAuraFlow" && target(gl, only(gl, "ModelSamplingAuraFlow").inputs.model)?.class_type === "LoraLoaderModelOnly", "…also with LoRAs (they come before the sampling node, so DifferentialDiffusion wraps the whole chain)");
  const g0 = buildDraw(z, { ...P, image: "start.png", denoise: 0.6, mask: "mask.png", grow: 0 });
  ok(nodesOfType(g0, "GrowMask").length === 0 && nodesOfType(g0, "DifferentialDiffusion").length === 1 && only(g0, "SetLatentNoiseMask").inputs.mask[0] === idOf(g0, "LoadImageMask"), "…with grow 0 there is no GrowMask, but DifferentialDiffusion is still added");
  ok(ids(buildDraw(z, { ...P, image: "start.png", denoise: 0.6, grow: 13 })).join() === ids(buildDraw(z, { ...P, image: "start.png", denoise: 0.6 })).join() && nodesOfType(buildDraw(z, { ...P, grow: 13 }), "DifferentialDiffusion").length === 0, "…with no mask, no GrowMask or DifferentialDiffusion is added");
}
// Redraw from a crop of the picture
{
  const j = (v: unknown) => JSON.stringify(v);
  const assertLinksResolve = (w: Workflow, label: string) => {
    const bad: string[] = [];
    for (const [id, node] of Object.entries(w)) {
      for (const [k, v] of Object.entries(node.inputs)) if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number" && !w[v[0]]) bad.push(`${id}.${k} -> ${v[0]}`);
    }
    ok(bad.length === 0, `${label}: every link points at an existing node${bad.length ? ` (${bad.join(", ")})` : ""}`);
  };
  const crop = { x: 100, y: 200, w: 400, h: 300, sw: 832, sh: 624, scale: 2 };
  const base = { ...P, image: "start.png", denoise: 0.6, width: 1000, height: 1500, mask: "mask.png", grow: 13 };
  const c = buildDraw(z, { ...base, crop });
  assertLinksResolve(c, "crop family");
  ok(j(c["11"].inputs) === j({ image: ["storytime_crop", 0], upscale_method: "lanczos", width: 832, height: 624, crop: "disabled" }), "crop family: the workflow's own ImageScale (11) reads the crop and scales it to sw by sh");
  ok(j(c["12"].inputs.pixels) === '["11",0]' && !("storytime_crop_scale" in c), "crop family: the VAEEncode reads that scaler, and no second scaler is added");
  ok(j(c.storytime_crop.inputs) === j({ image: ["10", 0], width: 400, height: 300, x: 100, y: 200 }) && c.storytime_crop.class_type === "ImageCrop", "crop family: the crop reads the full LoadImage at x, y, w, h");
  ok(j(c.storytime_mask_crop.inputs) === j({ mask: ["storytime_mask", 0], x: 100, y: 200, width: 400, height: 300 }) && j(c.storytime_mask_scaled.inputs) === j({ image: ["storytime_mask_img", 0], upscale_method: "bilinear", width: 832, height: 624, crop: "disabled" }), "crop family: the painted mask is cropped and scaled the same way");
  ok(nodesOfType(c, "SetLatentNoiseMask").length === 1 && nodesOfType(c, "GrowMask").length === 1 && only(c, "GrowMask").inputs.expand === 26 && j(c.storytime_noise_mask.inputs.mask) === j([idOf(c, "GrowMask"), 0]) && j(c.storytime_noise_mask.inputs.samples) === '["13",0]', "crop family: the sampled mask is grown exactly once, by grow times the scale");
  ok(sampler(c).class_type === "KSamplerAdvanced" && j(sampler(c).inputs.latent_image) === '["storytime_noise_mask",0]' && nodesOfType(c, "DifferentialDiffusion").length === 1 && target(c, sampler(c).inputs.model) === only(c, "DifferentialDiffusion"), "crop family: the sampler starts from the noise-masked latent, its model through DifferentialDiffusion once");
  const paste = only(c, "ImageCompositeMasked");
  const dest = target(c, paste.inputs.destination);
  const back = target(c, paste.inputs.source);
  ok(j(only(c, "SaveImage").inputs.images) === '["storytime_paste_1",0]' && nodesOfType(c, "ImageCompositeMasked").length === 1, "crop family: the saved picture comes through ImageCompositeMasked");
  ok(dest?.class_type === "RepeatImageBatch" && j(dest.inputs) === j({ image: ["10", 0], amount: 2 }), "crop family: …whose destination is the full picture repeated to the batch");
  ok(back?.class_type === "ImageScale" && j(back.inputs) === j({ image: ["20", 0], upscale_method: "lanczos", width: 400, height: 300, crop: "disabled" }), "crop family: …and whose source is the decoded crop scaled back to w by h");
  ok(paste.inputs.x === 100 && paste.inputs.y === 200 && j(paste.inputs.mask) === '["storytime_mask_crop",0]' && nodesOfType(c, "InvertMask").length === 0, "crop family: …pasted at x, y with the un-grown, un-inverted cropped mask");
  const cl = buildDraw(z, { ...base, crop, loras: [{ name: "a.safetensors", strength: 0.8 }] });
  assertLinksResolve(cl, "crop family with a LoRA");
  ok(target(cl, target(cl, sampler(cl).inputs.model)?.inputs.model)?.class_type === "ModelSamplingAuraFlow", "crop family: with LoRAs, DifferentialDiffusion still wraps the whole chain");
  const c0 = buildDraw(z, { ...base, crop, grow: 0 });
  ok(nodesOfType(c0, "GrowMask").length === 0 && nodesOfType(c0, "DifferentialDiffusion").length === 1, "crop family: with grow 0 there is no GrowMask, but DifferentialDiffusion is still added");
  const plain = buildDraw(z, base);
  ok(j(buildDraw(z, { ...base, crop: undefined })) === j(plain) && nodesOfType(plain, "ImageCrop").length === 0 && j(plain["11"].inputs).includes('"width":1008'), "crop family: without a crop the graph is exactly what it was");
  ok(j(buildDraw(z, { ...base, mask: undefined, crop })) === j(buildDraw(z, { ...base, mask: undefined })) && nodesOfType(buildDraw(z, { ...base, mask: undefined, crop }), "ImageCrop").length === 0, "crop family: with no mask a crop does nothing");
  ok(j(buildDraw(z, { ...P, mask: "mask.png", crop })) === j(buildDraw(z, P)), "crop family: with no picture a crop does nothing");
}
ok(only(wf, "ImageScale").inputs.width === 1008 && only(wf, "ImageScale").inputs.height === 1504, "…scaled to the size in multiples of 16");

// Settings, device, LoRAs
wf = buildDraw(z, { ...P, tuning: drawTuning(drawModel("zimage")!, { steps: 12, shift: 5, sampler: "euler", guidance: 9 }), textEncoderDevice: "cpu" });
ks = only(wf, "KSampler");
ok(ks.inputs.steps === 12 && ks.inputs.sampler_name === "euler" && ks.inputs.cfg === 1 && only(wf, "ModelSamplingAuraFlow").inputs.shift === 5, "changed settings apply (steps, sampler, shift) and the rest stay the defaults");
ok(drawTuning(drawModel("zimage")!, { guidance: 9 }).guidance === undefined && drawKnobs(drawModel("zimage")!).join() === "shift", "a setting the family doesn't have is left out (Z-Image has shift, not guidance)");
ok(wf["2"].inputs.device === "cpu", "the text encoder can be kept on the CPU");
wf = buildDraw(z, { ...P, loras: [{ name: "a.safetensors", strength: 0.8 }, { name: "b.safetensors", strength: -0.5 }] });
const loras = nodesOfType(wf, "LoraLoaderModelOnly");
ok(loras.length === 2 && loras[0][1].inputs.model[0] === "1" && loras[1][1].inputs.model[0] === loras[0][0] && loras[1][1].inputs.strength_model === -0.5, "LoRAs are a model-only chain after the model loader");
ok(only(wf, "ModelSamplingAuraFlow").inputs.model[0] === loras[1][0] && nodesOfType(wf, "LoraLoader").length === 0, "…and the sampling node takes the last one");

// GGUF
const zg = { unet: [...zFiles.unet!, "z_image_turbo-Q8_0.gguf"], clip: [...zFiles.clip!, "Qwen3-4B-Q4_K_M.gguf"], vae: zFiles.vae };
checks = checkDrawFamilies(info(zg, { gguf: true }));
z = byId(checks, "zimage");
ok(z.ready && z.files.model === "z_image_turbo_bf16.safetensors", "a safetensors file is preferred to a GGUF one of the same model");
ok(z.parts[0].choices.includes("z_image_turbo-Q8_0.gguf") && z.parts[0].choices.includes("flux1-dev-fp8.safetensors"), "…and the GGUF loader's files are among the choices");
let c = familyPresetCheck(checks, { family: "zimage", files: { model: "z_image_turbo-Q8_0.gguf", textEncoder: "Qwen3-4B-Q4_K_M.gguf" } })!;
ok(c.ready && c.files.model === "z_image_turbo-Q8_0.gguf", "a chosen .gguf model and text encoder are used");
wf = buildDraw(c, { ...P, textEncoderDevice: "cpu" });
ok(wf["1"].class_type === "UnetLoaderGGUF" && wf["1"].inputs.unet_name === "z_image_turbo-Q8_0.gguf" && !("weight_dtype" in wf["1"].inputs), "the model loader becomes UnetLoaderGGUF, without the inputs it doesn't list");
ok(wf["2"].class_type === "CLIPLoaderGGUF" && wf["2"].inputs.type === "lumina2" && !("device" in wf["2"].inputs), "…the text encoder CLIPLoaderGGUF keeps its type, and loses a device it doesn't list");
wf = buildDraw(familyPresetCheck(checkDrawFamilies(info(zg, { gguf: true, ggufDevice: true })), { family: "zimage", files: { textEncoder: "Qwen3-4B-Q4_K_M.gguf" } })!, { ...P, textEncoderDevice: "cpu" });
ok(wf["1"].class_type === "UNETLoader" && wf["2"].class_type === "CLIPLoaderGGUF" && wf["2"].inputs.device === "cpu", "…which keeps it when the GGUF loader lists it; a model not chosen as .gguf keeps its loader");
wf = buildDraw(familyPresetCheck(checkDrawFamilies(info(zFiles)), { family: "zimage", files: {} })!, { ...P, textEncoderDevice: "cpu" });
ok(wf["2"].class_type === "CLIPLoader" && wf["2"].inputs.device === "cpu", "without .gguf files nothing is switched");

// Without ComfyUI-GGUF, a .gguf file isn't listed at all; a chosen one isn't found.
c = familyPresetCheck(checkDrawFamilies(info(zFiles)), { family: "zimage", files: { model: "z_image_turbo-Q8_0.gguf" } })!;
ok(!c.ready && c.parts[0].file === null && c.parts[0].chosen === "z_image_turbo-Q8_0.gguf" && familyProblems(c).some((s) => s.includes("doesn't list z_image_turbo-Q8_0.gguf")), "a chosen .gguf file that ComfyUI doesn't list stops the preset, and says which");
// With the files listed by the ordinary loader but no GGUF nodes (a stale list), the nodes are what is missing.
const stale = info(zg, { gguf: true, missing: ["UnetLoaderGGUF"] });
c = familyPresetCheck(checkDrawFamilies({ ...stale, UNETLoader: { input: { required: { unet_name: [zg.unet, {}] } } } }), { family: "zimage", files: { model: "z_image_turbo-Q8_0.gguf" } })!;
ok(!c.ready && ggufNeeded(c).join() === "UnetLoaderGGUF" && familyProblems(c).some((s) => s.includes("ComfyUI-GGUF")), "a .gguf file without ComfyUI-GGUF's loader stops the preset and says to install ComfyUI-GGUF");

// Nodes and options
z = byId(checkDrawFamilies(info(zFiles, { missing: ["ModelSamplingAuraFlow"] })), "zimage");
ok(!z.ready && z.missingNodes.join() === "ModelSamplingAuraFlow" && familyProblems(z).some((s) => s.includes("ModelSamplingAuraFlow")), "a missing node stops the family and is named");
z = byId(checkDrawFamilies(info(zFiles, { types: ["stable_diffusion", "sd3"] })), "zimage");
ok(!z.ready && z.missingOptions.join() === "CLIPLoader type: lumina2", "an old ComfyUI whose CLIPLoader has no lumina2 type stops it");
// A .gguf text encoder is loaded by CLIPLoaderGGUF, whose type list must have lumina2 too.
const oldGguf = { ...info(zg, { gguf: true }), CLIPLoaderGGUF: { input: { required: { clip_name: [zg.clip, {}], type: [["stable_diffusion"], {}] } } } };
ok(byId(checkDrawFamilies(oldGguf), "zimage").ready, "a safetensors text encoder doesn't need the GGUF loader's types");
c = familyPresetCheck(checkDrawFamilies(oldGguf), { family: "zimage", files: { textEncoder: "Qwen3-4B-Q4_K_M.gguf" } })!;
ok(!c.ready && c.missingOptions.join() === "CLIPLoaderGGUF type: lumina2", "…but a .gguf one does, and the check names the GGUF loader");
c = familyPresetCheck(checkDrawFamilies(info(zg, { gguf: true })), { family: "zimage", files: { textEncoder: "Qwen3-4B-Q4_K_M.gguf" } })!;
ok(c.ready && c.devices.length === 0, "the text encoder device choices come from the loader in use (the GGUF one lists none here)");
ok(byId(checkDrawFamilies(info(zFiles)), "zimage").devices.join() === "default,cpu", "…the ordinary one lists default and cpu");
ok(familyPresetCheck(checks, { family: "checkpoint", files: {} }) === null, "the checkpoint family has no check");

// ---- the summary ----
const zp = { ...newDrawPreset("z", "Z"), family: "zimage" as const, files: { model: "sub/z_image_turbo-Q8_0.gguf" }, loras: [{ name: "a", strength: 1, on: true }] };
ok(drawPresetSummary(zp) === "Z-Image · z_image_turbo-Q8_0 · 1 LoRA", `a family preset's summary has the family and the model file (${drawPresetSummary(zp)})`);
ok(drawPresetSummary({ ...zp, files: {}, loras: [] }) === "Z-Image · model found by name", "…or says the model is found by its name");
ok(drawPresetSummary({ ...newDrawPreset("c", "C"), checkpoint: "sdxl/juggernaut.safetensors" }) === "juggernaut", "a checkpoint preset's summary is as before");

// ---- Flux ----
const fFiles: Files = {
  unet: ["flux1-dev-fp8.safetensors", "flux1-dev-kontext_fp8_scaled.safetensors", "chroma-unlocked-v50.safetensors", "z_image_turbo_bf16.safetensors", "qwen_image_edit_2509_fp8_e4m3fn.safetensors"],
  clip: ["clip_l.safetensors", "t5xxl_fp8_e4m3fn_scaled.safetensors", "qwen_3_4b.safetensors"],
  vae: ["ae.safetensors"],
};
let f = byId(checkDrawFamilies(info(fFiles)), "flux");
ok(f.ready && f.files.model === "flux1-dev-fp8.safetensors" && f.files.clipL === "clip_l.safetensors" && f.files.t5 === "t5xxl_fp8_e4m3fn_scaled.safetensors" && f.files.vae === "ae.safetensors", "Flux: every file is found by its name");
f = byId(checkDrawFamilies(info({ ...fFiles, unet: fFiles.unet!.slice(1) })), "flux");
ok(!f.ready && f.parts[0].file === null, "…Kontext, Chroma, Z-Image and Qwen files are not a Flux model");
f = byId(checkDrawFamilies(info({ ...fFiles, unet: ["FLUX/flux_dev_fp8_scaled_diffusion_model.safetensors", "flux1-schnell-Q4_K_S.gguf"] })), "flux");
ok(f.ready && f.files.model === "FLUX/flux_dev_fp8_scaled_diffusion_model.safetensors", "…another Flux file (a fine-tune, a subfolder) is found by its name");
f = byId(checkDrawFamilies(info(fFiles, { types: TYPES })), "flux");
ok(byId(checkDrawFamilies(info({ ...fFiles, unet: ["flux1-dev-kontext_fp8_scaled.safetensors"] })), "zimage").parts[0].file === null, "…and a Z-Image preset doesn't take the Flux files either");

wf = buildDraw(f, P);
ks = only(wf, "KSampler");
ok(wf["2"].class_type === "DualCLIPLoader" && wf["2"].inputs.type === "flux" && wf["2"].inputs.clip_name1 === "clip_l.safetensors" && wf["2"].inputs.clip_name2 === "t5xxl_fp8_e4m3fn_scaled.safetensors" && wf["2"].inputs.device === "default", "Flux: DualCLIPLoader with CLIP-L and T5-XXL, type flux");
ok(ks.inputs.steps === 20 && ks.inputs.cfg === 1 && ks.inputs.sampler_name === "euler" && ks.inputs.scheduler === "simple", "…20 steps of euler simple at CFG 1");
const guide = target(wf, ks.inputs.positive), enc2 = target(wf, guide?.inputs.conditioning);
ok(guide?.class_type === "FluxGuidance" && guide.inputs.guidance === 3.5 && enc2?.class_type === "CLIPTextEncode" && enc2.inputs.text === P.prompt, "…the prompt goes through FluxGuidance 3.5");
ok(target(wf, ks.inputs.negative)?.class_type === "ConditioningZeroOut" && target(wf, target(wf, ks.inputs.negative)!.inputs.conditioning) === enc2 && nodesOfType(wf, "ModelSamplingAuraFlow").length === 0, "…the negative is the encoded prompt zeroed out; no ModelSamplingAuraFlow");
ok(target(wf, ks.inputs.model)?.class_type === "UNETLoader" && target(wf, only(wf, "VAEDecode").inputs.vae)?.class_type === "VAELoader", "…the sampler takes the model loader's output");
ok(drawKnobs(drawModel("flux")!).join() === "guidance" && drawTuning(drawModel("flux")!, { guidance: 2, shift: 9 }).guidance === 2 && drawTuning(drawModel("flux")!, { shift: 9 }).shift === undefined, "Flux has a guidance setting, not shift");
wf = buildDraw(f, { ...P, tuning: drawTuning(drawModel("flux")!, { guidance: 2, steps: 4 }), loras: [{ name: "style.safetensors", strength: 0.7 }] });
ok(only(wf, "FluxGuidance").inputs.guidance === 2 && only(wf, "KSampler").inputs.steps === 4 && only(wf, "KSampler").inputs.model[0] === idOf(wf, "LoraLoaderModelOnly") && only(wf, "LoraLoaderModelOnly").inputs.model[0] === "1", "changed guidance and steps apply, and LoRAs chain after the model loader into the sampler");
wf = buildDraw(f, { ...P, image: "s.png", denoise: 0.4 });
ok(nodesOfType(wf, "EmptySD3LatentImage").length === 0 && sampler(wf).inputs.start_at_step === sampler(wf).inputs.steps - stepsToRun(sampler(wf).inputs.steps, 0.4) && sampler(wf).inputs.latent_image[0] === idOf(wf, "RepeatLatentBatch") && only(wf, "VAEEncode").inputs.vae[0] === "3", "Flux Redraw: the same start from the picture");

const fg = { unet: [...fFiles.unet!, "flux1-dev-Q4_K_S.gguf"], clip: [...fFiles.clip!, "t5-v1_1-xxl-encoder-Q5_K_M.gguf"], vae: fFiles.vae };
let fc = familyPresetCheck(checkDrawFamilies(info(fg, { gguf: true })), { family: "flux", files: { model: "flux1-dev-Q4_K_S.gguf", t5: "t5-v1_1-xxl-encoder-Q5_K_M.gguf" } })!;
wf = buildDraw(fc, { ...P, textEncoderDevice: "cpu" });
ok(fc.ready && wf["1"].class_type === "UnetLoaderGGUF" && wf["2"].class_type === "DualCLIPLoaderGGUF" && wf["2"].inputs.clip_name1 === "clip_l.safetensors" && wf["2"].inputs.clip_name2 === "t5-v1_1-xxl-encoder-Q5_K_M.gguf" && wf["2"].inputs.type === "flux", "Flux GGUF: UnetLoaderGGUF and DualCLIPLoaderGGUF with both encoders' files");
ok(!("device" in wf["2"].inputs) && wf["3"].class_type === "VAELoader", "…which has no device input, so none is sent; the VAE loader is unchanged");
ok(byId(checkDrawFamilies(info(fg, { gguf: true })), "flux").files.model === "flux1-dev-fp8.safetensors", "…and the safetensors model is still preferred when found by name");

// ---- Chroma ----
const cFiles: Files = { unet: ["chroma-unlocked-v50.safetensors", "flux1-dev-fp8.safetensors"], clip: ["t5xxl_fp8_e4m3fn_scaled.safetensors", "clip_l.safetensors"], vae: ["ae.safetensors"] };
let ch = byId(checkDrawFamilies(info(cFiles)), "chroma");
ok(ch.ready && ch.files.model === "chroma-unlocked-v50.safetensors" && ch.files.textEncoder === "t5xxl_fp8_e4m3fn_scaled.safetensors" && ch.files.vae === "ae.safetensors", "Chroma: its model, T5-XXL and the Flux VAE are found by their names");
ok(!byId(checkDrawFamilies(info({ ...cFiles, unet: ["flux1-dev-fp8.safetensors"] })), "chroma").ready && byId(checkDrawFamilies(info({ ...cFiles, unet: ["flux1-dev-fp8.safetensors"] })), "flux").ready, "…Flux's model isn't Chroma's, nor Chroma's Flux's");
ok(!byId(checkDrawFamilies(info(cFiles, { types: ["stable_diffusion", "sd3"] })), "chroma").ready && byId(checkDrawFamilies(info(cFiles, { types: ["stable_diffusion", "sd3"] })), "chroma").missingOptions.join() === "CLIPLoader type: chroma", "an old ComfyUI without the chroma text encoder type stops it");
ok(ch.optionalNodes.length === 0 && byId(checkDrawFamilies(info(cFiles, { tokenizer: true })), "chroma").optionalNodes.join() === "T5TokenizerOptions" && ch.ready, "T5TokenizerOptions is optional: noted when ComfyUI has it, and not needed to be ready");

wf = buildDraw(ch, P);
ks = only(wf, "KSampler");
ok(wf["2"].class_type === "CLIPLoader" && wf["2"].inputs.type === "chroma" && wf["2"].inputs.clip_name === ch.files.textEncoder, "Chroma: a CLIPLoader of type chroma with T5-XXL");
ok(ks.inputs.steps === 26 && ks.inputs.cfg === 4 && ks.inputs.sampler_name === "euler" && ks.inputs.scheduler === "beta", "…26 steps of euler beta at CFG 4");
const cpos = target(wf, ks.inputs.positive), cneg = target(wf, ks.inputs.negative);
ok(cpos?.class_type === "CLIPTextEncode" && cpos.inputs.text === P.prompt && cneg?.class_type === "CLIPTextEncode" && cneg.inputs.text === "blurry" && cpos !== cneg, "…a real negative prompt, encoded on its own");
ok(nodesOfType(wf, "T5TokenizerOptions").length === 0 && cpos.inputs.clip[0] === "2" && nodesOfType(wf, "ConditioningZeroOut").length === 0 && nodesOfType(wf, "FluxGuidance").length === 0, "…without T5TokenizerOptions when ComfyUI doesn't have it, and no guidance node");
ch = byId(checkDrawFamilies(info(cFiles, { tokenizer: true })), "chroma");
wf = buildDraw(ch, P);
const tok = only(wf, "T5TokenizerOptions");
ok(tok.inputs.min_padding === 1 && tok.inputs.min_length === 0 && tok.inputs.clip[0] === "2", "with it, T5TokenizerOptions (min_padding 1, min_length 0) follows the loader");
ok(target(wf, only(wf, "KSampler").inputs.positive)?.inputs.clip[0] === idOf(wf, "T5TokenizerOptions") && target(wf, only(wf, "KSampler").inputs.negative)?.inputs.clip[0] === idOf(wf, "T5TokenizerOptions"), "…and both prompts are encoded through it");
wf = buildDraw(ch, { ...P, image: "s.png", denoise: 0.7, textEncoderDevice: "cpu", loras: [{ name: "l.safetensors", strength: 1 }] });
ok(wf["2"].inputs.device === "cpu" && sampler(wf).inputs.start_at_step === sampler(wf).inputs.steps - stepsToRun(sampler(wf).inputs.steps, 0.7) && sampler(wf).inputs.model[0] === idOf(wf, "LoraLoaderModelOnly") && nodesOfType(wf, "EmptySD3LatentImage").length === 0, "Chroma: device cpu, a LoRA chain and Redraw work too");

const cg = { unet: [...cFiles.unet!, "Chroma1-HD-Q5_K_S.gguf"], clip: [...cFiles.clip!, "t5-v1_1-xxl-encoder-Q5_K_M.gguf"], vae: cFiles.vae };
const cc = familyPresetCheck(checkDrawFamilies(info(cg, { gguf: true })), { family: "chroma", files: { model: "Chroma1-HD-Q5_K_S.gguf", textEncoder: "t5-v1_1-xxl-encoder-Q5_K_M.gguf" } })!;
wf = buildDraw(cc, { ...P, textEncoderDevice: "cpu" });
ok(cc.ready && wf["1"].class_type === "UnetLoaderGGUF" && wf["2"].class_type === "CLIPLoaderGGUF" && wf["2"].inputs.type === "chroma" && wf["2"].inputs.clip_name === "t5-v1_1-xxl-encoder-Q5_K_M.gguf" && !("device" in wf["2"].inputs), "Chroma GGUF: UnetLoaderGGUF and CLIPLoaderGGUF (type chroma), no device the GGUF loader doesn't list");

// ---- Qwen-Image ----
const qFiles: Files = {
  unet: ["qwen_image_edit_2509_fp8_e4m3fn.safetensors", "qwen_image_fp8_e4m3fn.safetensors", "flux1-dev-fp8.safetensors"],
  clip: ["qwen_2.5_vl_7b_fp8_scaled.safetensors", "qwen_3_4b.safetensors"],
  vae: ["qwen_image_vae.safetensors", "ae.safetensors"],
};
let qi = byId(checkDrawFamilies(info(qFiles)), "qwen-image");
ok(qi.ready && qi.files.model === "qwen_image_fp8_e4m3fn.safetensors" && qi.files.textEncoder === "qwen_2.5_vl_7b_fp8_scaled.safetensors" && qi.files.vae === "qwen_image_vae.safetensors", "Qwen-Image: its files are found by their names, not Qwen-Image-Edit's");
qi = byId(checkDrawFamilies(info({ ...qFiles, unet: ["qwen_image_edit_2509_fp8_e4m3fn.safetensors", "Qwen-Image-Edit-2511-Q4_K_M.gguf", "Qwen-Image-Edit-Rapid-AIO-v11-Q4_0.gguf"] }, { gguf: true })), "qwen-image");
ok(!qi.ready && qi.parts[0].file === null, "…none of the Qwen-Image-Edit files (safetensors, GGUF, Rapid AIO) is taken for the drawing model");
const editChecks = checkEditModels(info({ ...qFiles, unet: ["qwen_image_fp8_e4m3fn.safetensors", "Qwen-Image-Q4_K_S.gguf", "Qwen-Image-2512-Q4_K_M.gguf"] }, { gguf: true }));
ok(editChecks.find((c) => c.model.id === "qwen-image-edit")!.parts[0].file === null, "…and the edit model doesn't take the drawing model's files either");
qi = byId(checkDrawFamilies(info({ ...qFiles, unet: ["sub/Qwen-Image-2512-bf16.safetensors"] })), "qwen-image");
ok(qi.ready && qi.files.model === "sub/Qwen-Image-2512-bf16.safetensors", "…another release of Qwen-Image is found by its name");
qi = byId(checkDrawFamilies(info(qFiles)), "qwen-image");

wf = buildDraw(qi, P);
ks = only(wf, "KSampler");
ok(wf["2"].class_type === "CLIPLoader" && wf["2"].inputs.type === "qwen_image" && wf["2"].inputs.clip_name === qi.files.textEncoder && wf["3"].inputs.vae_name === "qwen_image_vae.safetensors", "Qwen-Image: a qwen_image CLIPLoader and its own VAE");
ok(ks.inputs.steps === 20 && ks.inputs.cfg === 2.5 && ks.inputs.sampler_name === "euler" && ks.inputs.scheduler === "simple", "…20 steps of euler simple at CFG 2.5");
ok(only(wf, "ModelSamplingAuraFlow").inputs.shift === 3.1 && target(wf, ks.inputs.model)?.class_type === "ModelSamplingAuraFlow", "…the model goes through ModelSamplingAuraFlow, shift 3.1");
ok(target(wf, ks.inputs.positive)?.inputs.text === P.prompt && target(wf, ks.inputs.negative)?.inputs.text === "blurry" && target(wf, ks.inputs.negative)?.class_type === "CLIPTextEncode", "…with a real negative prompt");
ok(only(wf, "EmptySD3LatentImage").inputs.width === 832 && nodesOfType(wf, "CFGNorm").length === 0, "…on an EmptySD3LatentImage (16-channel latents), without the edit model's CFGNorm");
ok(drawKnobs(drawModel("qwen-image")!).join() === "shift" && drawTuning(drawModel("qwen-image")!, { shift: 2 }).shift === 2, "Qwen-Image has a shift setting");
wf = buildDraw(qi, { ...P, image: "s.png", denoise: 0.5, loras: [{ name: "q.safetensors", strength: 0.9 }], tuning: drawTuning(drawModel("qwen-image")!, { cfg: 3, shift: 2 }) });
ok(sampler(wf).inputs.start_at_step === sampler(wf).inputs.steps - stepsToRun(sampler(wf).inputs.steps, 0.5) && sampler(wf).inputs.cfg === 3 && only(wf, "ModelSamplingAuraFlow").inputs.shift === 2 && only(wf, "ModelSamplingAuraFlow").inputs.model[0] === idOf(wf, "LoraLoaderModelOnly") && nodesOfType(wf, "RepeatLatentBatch").length === 1, "Qwen-Image Redraw, a LoRA and changed settings");

const qg = { unet: [...qFiles.unet!, "Qwen-Image-Q4_K_S.gguf"], clip: [...qFiles.clip!, "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf", "Qwen2.5-VL-7B-Instruct-mmproj-F16.gguf"], vae: qFiles.vae };
const qc = familyPresetCheck(checkDrawFamilies(info(qg, { gguf: true })), { family: "qwen-image", files: { model: "Qwen-Image-Q4_K_S.gguf", textEncoder: "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" } })!;
wf = buildDraw(qc, { ...P, textEncoderDevice: "cpu" });
ok(qc.ready && wf["1"].class_type === "UnetLoaderGGUF" && wf["1"].inputs.unet_name === "Qwen-Image-Q4_K_S.gguf" && wf["2"].class_type === "CLIPLoaderGGUF" && wf["2"].inputs.type === "qwen_image" && !("device" in wf["2"].inputs), "Qwen-Image GGUF: UnetLoaderGGUF and CLIPLoaderGGUF");
const qcpu = familyPresetCheck(checkDrawFamilies(info(qg, { gguf: true, ggufDevice: true })), { family: "qwen-image", files: { model: "Qwen-Image-Q4_K_S.gguf" } })!;
ok(qcpu.ready && qcpu.devices.join() === "default,cpu" && buildDraw(qcpu, { ...P, textEncoderDevice: "cpu" })["2"].inputs.device === "cpu", "…the ordinary text encoder keeps the cpu device");
ok(byId(checkDrawFamilies(info({ ...qg, clip: ["Qwen2.5-VL-7B-Instruct-mmproj-F16.gguf"] }, { gguf: true })), "qwen-image").parts[1].file === null, "…and a Qwen 2.5 VL mmproj file is not a text encoder");

// ---- Krea 2 (Kroma) ----
const kFiles: Files = {
  unet: ["kroma-v0.3.1-turbo-opd.safetensors", "z_image_turbo_bf16.safetensors", "Chroma1-HD.safetensors"],
  clip: ["qwen3vl_4b_bf16.safetensors", "qwen_3_4b.safetensors", "t5xxl_fp8_e4m3fn_scaled.safetensors"],
  vae: ["wan_2.1_vae.safetensors", "ae.safetensors"],
};
checks = checkDrawFamilies(info(kFiles));
const k = byId(checks, "krea2");
ok(k.ready && k.files.model === "kroma-v0.3.1-turbo-opd.safetensors" && k.files.textEncoder === "qwen3vl_4b_bf16.safetensors" && k.files.vae === "wan_2.1_vae.safetensors", "Krea 2: its three files are found by name among the other families' files");
ok(byId(checks, "zimage").files.textEncoder === "qwen_3_4b.safetensors" && byId(checks, "chroma").files.model === "Chroma1-HD.safetensors", "…and the other families don't pick them up (Qwen 3 VL isn't Qwen 3 4B; Kroma isn't Chroma)");
ok(!byId(checkDrawFamilies(info(kFiles, { types: TYPES.filter((t) => t !== "krea2") })), "krea2").ready, "…ComfyUI without the krea2 text encoder type isn't ready");
wf = buildDraw(k, { ...P, seed: 9 });
ok(wf["2"].class_type === "CLIPLoader" && wf["2"].inputs.type === "krea2" && wf["1"].class_type === "UNETLoader" && wf["3"].inputs.vae_name === "wan_2.1_vae.safetensors", "Krea 2: a krea2 CLIPLoader, the Kroma model and the Wan VAE");
const first = only(wf, "KSampler");
ok(first.inputs.steps === 8 && first.inputs.cfg === 1 && first.inputs.sampler_name === "euler" && first.inputs.scheduler === "simple" && first.inputs.denoise === 1, "…8 steps of euler simple at CFG 1");
const kneg = target(wf, first.inputs.negative);
ok(kneg?.class_type === "ConditioningZeroOut" && target(wf, kneg.inputs.conditioning) === target(wf, first.inputs.positive), "…and the negative is the positive zeroed out");
const refine = wf["42"], up = wf["40"];
ok(up.class_type === "ImageScaleBy" && up.inputs.scale_by === 2 && up.inputs.upscale_method === "lanczos" && up.inputs.image[0] === "20", "…the picture is then scaled up 2x with lanczos");
ok(wf["41"].inputs.pixels[0] === "40" && refine.inputs.latent_image[0] === "41" && refine.inputs.steps === 4 && refine.inputs.sampler_name === "res_multistep" && refine.inputs.scheduler === "beta" && refine.inputs.denoise === 0.14 && refine.inputs.seed === 9, "…encoded again and redrawn by a second sampler (4 steps, denoise 0.14, same seed)");
ok(only(wf, "SaveImage").inputs.images[0] === "43" && wf["43"].inputs.samples[0] === "42", "…and the saved pictures are the second decode");
wf = buildDraw(k, { ...P, tuning: drawTuning(drawModel("krea2")!, { upscale: 1 }) });
ok(!wf["40"] && !wf["42"] && only(wf, "SaveImage").inputs.images[0] === "20", "an Upscale of 1 skips the second pass");
wf = buildDraw(k, { ...P, image: "start.png", denoise: 0.5 });
ok(!wf["40"] && sampler(wf).inputs.start_at_step === sampler(wf).inputs.steps - stepsToRun(sampler(wf).inputs.steps, 0.5), "Redraw skips it too");
wf = buildDraw(k, { ...P, loras: [{ name: "AmateurSlider-KREA2_v1.safetensors", strength: 1.1 }] });
const kl = only(wf, "LoraLoaderModelOnly");
ok(kl.inputs.strength_model === 1.1 && wf["8"].inputs.model[0] === idOf(wf, "LoraLoaderModelOnly") && wf["42"].inputs.model[0] === idOf(wf, "LoraLoaderModelOnly"), "the Amateur slider is a LoRA of the preset, used by both samplers");
ok(drawKnobs(drawModel("krea2")!).join() === "upscale" && drawTuning(drawModel("krea2")!, { upscale: 1.5, shift: 3 }).upscale === 1.5 && drawTuning(drawModel("krea2")!, { shift: 3 }).shift === undefined, "Upscale is Krea 2's own setting, and other families' settings are left out");
ok(parsed({ ...oldPreset, family: "krea2", sampler: { upscale: 9 } }).sampler.upscale === undefined && parsed({ ...oldPreset, family: "krea2", sampler: { upscale: 1.5 } }).sampler.upscale === 1.5, "the upscale is kept in the preset's settings within 1 to 4");

// A preset of one family never uses another's check.
ok(familyPresetCheck(checkDrawFamilies(info(cFiles)), { family: "chroma", files: {} })!.model.id === "chroma" && drawPresetSummary({ ...zp, family: "flux", files: {}, loras: [] }) === "Flux · model found by name", "the summary names the preset's own family");
