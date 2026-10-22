// The newer drawing models (Z-Image, Flux, Chroma, Qwen-Image): what the check finds in ComfyUI's /object_info,
// the workflows built from it, and the drawing preset's summary. Pure logic, no server.
import {
  buildDraw, checkDrawFamilies, DRAW_FAMILIES, DRAW_MODELS, DRAW_NODES, drawKnobs, drawModel, drawTuning, familyPresetCheck, familyProblems, ggufNeeded,
  type DrawParams, type FamilyCheck,
} from "../../src/lib/comfy/drawModels.ts";
import { drawPresetSummary, newDrawPreset, usesFamily } from "../../src/lib/comfy/presets.ts";
import { parseSettings } from "../../src/lib/settingsSchema.ts";
import type { NodeInfo } from "../../src/lib/comfy/modelParts.ts";
import type { Workflow } from "../../src/lib/comfy/workflow.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

type Files = { unet?: string[]; clip?: string[]; vae?: string[] };
const TYPES = ["stable_diffusion", "sd3", "qwen_image", "lumina2", "chroma"];

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
ks = only(wf, "KSampler");
const load = idOf(wf, "LoadImage"), scale = idOf(wf, "ImageScale"), enc = idOf(wf, "VAEEncode"), rep = idOf(wf, "RepeatLatentBatch");
ok(only(wf, "LoadImage").inputs.image === "start.png" && only(wf, "ImageScale").inputs.image[0] === load && only(wf, "VAEEncode").inputs.pixels[0] === scale && only(wf, "VAEEncode").inputs.vae[0] === "3" && only(wf, "RepeatLatentBatch").inputs.samples[0] === enc, "Redraw: LoadImage → ImageScale → VAEEncode → RepeatLatentBatch");
ok(ks.inputs.latent_image[0] === rep && only(wf, "RepeatLatentBatch").inputs.amount === 2 && ks.inputs.denoise === 0.6 && nodesOfType(wf, "EmptySD3LatentImage").length === 0, "…the sampler starts from it at the Redraw strength, with no empty latent");
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
