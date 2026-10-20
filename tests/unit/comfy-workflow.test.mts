import { BUILTIN_IMG2IMG, BUILTIN_WORKFLOW, describeWorkflow, filenamePrefix, fillWorkflow, parseWorkflow, randomSeed, WorkflowError, type PictureParams, type Workflow } from "../../src/lib/comfy/workflow.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const throwsWorkflowError = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof WorkflowError ? e.message : `wrong error: ${e}`; }
  return null;
};

const params: PictureParams = { prompt: "a lighthouse at dawn", negative: "text, watermark", checkpoint: "sdxl_base.safetensors", width: 1344, height: 768, count: 2, seed: 12345 };

// ---- parseWorkflow ----
ok(parseWorkflow("") === BUILTIN_WORKFLOW && parseWorkflow("  \n ") === BUILTIN_WORKFLOW, "an empty workflow is the built-in one");
ok(/isn't valid JSON/.test(throwsWorkflowError(() => parseWorkflow("{nope")) ?? ""), "text that isn't JSON is refused");
ok(/JSON object of nodes/.test(throwsWorkflowError(() => parseWorkflow("[1,2]")) ?? ""), "a JSON array is refused");
ok(/JSON object of nodes/.test(throwsWorkflowError(() => parseWorkflow("42")) ?? ""), "a JSON number is refused");
ok(/JSON object of nodes/.test(throwsWorkflowError(() => parseWorkflow("null")) ?? ""), "JSON null is refused");
ok(/no nodes/.test(throwsWorkflowError(() => parseWorkflow("{}")) ?? ""), "an empty object is refused");
const uiFormat = JSON.stringify({ last_node_id: 3, nodes: [{ id: 1, type: "KSampler" }], links: [[1, 1, 0, 2, 0, "LATENT"]], version: 0.4 });
ok(/API format/.test(throwsWorkflowError(() => parseWorkflow(uiFormat)) ?? ""), "ComfyUI's regular (UI) workflow file is refused, pointing to Export (API)");
const noClass = throwsWorkflowError(() => parseWorkflow(JSON.stringify({ "3": { inputs: { seed: 1 } } })));
ok(noClass !== null && noClass.includes("Node 3") && noClass.includes("class_type"), "a node without class_type is refused, naming the node");
ok(throwsWorkflowError(() => parseWorkflow(JSON.stringify({ "3": { class_type: "KSampler" } }))) !== null, "a node without inputs is refused");
ok(throwsWorkflowError(() => parseWorkflow(JSON.stringify({ "3": null }))) !== null, "a null node is refused");
const parsed = parseWorkflow(JSON.stringify(BUILTIN_WORKFLOW));
ok(parsed !== BUILTIN_WORKFLOW && Object.keys(parsed).length === Object.keys(BUILTIN_WORKFLOW).length, "a valid API-format workflow is parsed as its own copy");

// ---- the built-in workflow ----
const builtinBefore = JSON.stringify(BUILTIN_WORKFLOW);
const built = fillWorkflow(BUILTIN_WORKFLOW, params);
ok(JSON.stringify(BUILTIN_WORKFLOW) === builtinBefore, "filling the built-in workflow does not change it");
ok(built !== BUILTIN_WORKFLOW && built["3"] !== BUILTIN_WORKFLOW["3"], "…it returns a copy");
ok(built["3"].inputs.seed === 12345 && typeof built["3"].inputs.seed === "number", "builtin: the seed is a number");
ok(built["5"].inputs.width === 1344 && built["5"].inputs.height === 768 && built["5"].inputs.batch_size === 2, "builtin: width, height and batch_size are numbers");
ok(typeof built["5"].inputs.width === "number" && typeof built["5"].inputs.batch_size === "number", "builtin: …not strings");
ok(built["6"].inputs.text === "a lighthouse at dawn" && built["7"].inputs.text === "text, watermark", "builtin: the prompt and negative prompt are in the text encoders");
ok(built["4"].inputs.ckpt_name === "sdxl_base.safetensors", "builtin: the checkpoint is set");
ok(JSON.stringify(built).includes("{{") === false, "builtin: no placeholder is left");
ok(JSON.stringify(built["8"].inputs.samples) === '["3",0]' && JSON.stringify(built["6"].inputs.clip) === '["4",1]', "builtin: links are unchanged");
const tricky = fillWorkflow(BUILTIN_WORKFLOW, { ...params, prompt: 'a "quoted" {{seed}} $& prompt' });
ok(tricky["6"].inputs.text === 'a "quoted" {{seed}} $& prompt', "a prompt with quotes, $& and braces is inserted literally");
const fit0 = describeWorkflow(BUILTIN_WORKFLOW);
ok(fit0.mode === "builtin" && fit0.prompt && fit0.negative && fit0.checkpoint && fit0.size && fit0.count && fit0.seed, "describe: the built-in workflow lets everything be set");

// ---- a placeholder workflow ----
const custom: Workflow = {
  "1": { class_type: "KSampler", inputs: { seed: "{{seed}}", steps: 20, cfg: 4, positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], model: ["5", 0] } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "masterpiece, {{prompt}}, highly detailed", clip: ["5", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "{{negative}}", clip: ["5", 1] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: 512, batch_size: "{{count}}" } },
  "5": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "fixed.safetensors" } },
};
const customBefore = JSON.stringify(custom);
const filled = fillWorkflow(custom, params);
ok(JSON.stringify(custom) === customBefore, "placeholders: the original is not changed");
ok(filled["1"].inputs.seed === 12345 && filled["4"].inputs.width === 1344 && filled["4"].inputs.batch_size === 2, "placeholders: exact numeric placeholders become numbers");
ok(filled["4"].inputs.height === 512, "placeholders: an input without a placeholder keeps its own value");
ok(filled["2"].inputs.text === "masterpiece, a lighthouse at dawn, highly detailed", "placeholders: {{prompt}} is replaced inside a longer text");
ok(filled["3"].inputs.text === "text, watermark" && filled["5"].inputs.ckpt_name === "fixed.safetensors", "placeholders: the negative is filled and an unmarked checkpoint is left alone");
const fitC = describeWorkflow(custom);
ok(fitC.mode === "placeholders" && fitC.prompt && fitC.negative && fitC.seed && fitC.count && !fitC.checkpoint && !fitC.size, "describe: placeholders lists what was found (width but no height is not 'size', no checkpoint)");
const checkpointInText: Workflow = { "1": { class_type: "LoraLoader", inputs: { lora_name: "style_{{checkpoint}}_v2" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } } };
ok(fillWorkflow(checkpointInText, params)["1"].inputs.lora_name === "style_sdxl_base.safetensors_v2","placeholders: {{checkpoint}} works inside a longer text too");

// ---- placeholders but no {{prompt}} ----
const noPrompt: Workflow = { "1": { class_type: "KSampler", inputs: { seed: "{{seed}}" } }, "2": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } } };
const noPromptMsg = throwsWorkflowError(() => fillWorkflow(noPrompt, params));
ok(noPromptMsg !== null && noPromptMsg.includes("{{prompt}}"), "placeholders without {{prompt}} are an error that mentions {{prompt}}");
ok(describeWorkflow(noPrompt).mode === "placeholders" && !describeWorkflow(noPrompt).prompt, "describe: …and the prompt is reported as missing");

// ---- detection: a typical SDXL export, no placeholders ----
const sdxl: Workflow = {
  "3": { class_type: "KSampler", inputs: { seed: 156680208700286, steps: 20, cfg: 8, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "beautiful scenery nature glass bottle landscape", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } },
};
const sdxlBefore = JSON.stringify(sdxl);
const sdxlOut = fillWorkflow(sdxl, params);
ok(JSON.stringify(sdxl) === sdxlBefore, "detect SDXL: the original is not changed");
ok(sdxlOut["6"].inputs.text === "a lighthouse at dawn" && sdxlOut["7"].inputs.text === "text, watermark", "detect SDXL: the positive prompt goes to the node on the sampler's positive link, the negative to the other");
ok(fillWorkflow(sdxl, { ...params, negative: "blurry" })["7"].inputs.text === "blurry", "detect SDXL: the negative prompt is set");
ok(sdxlOut["4"].inputs.ckpt_name === "sdxl_base.safetensors", "detect SDXL: the checkpoint is set");
ok(sdxlOut["5"].inputs.width === 1344 && sdxlOut["5"].inputs.height === 768 && sdxlOut["5"].inputs.batch_size === 2, "detect SDXL: the latent size and batch size are set");
ok(sdxlOut["3"].inputs.seed === 12345, "detect SDXL: the seed is set");
ok(sdxlOut["3"].inputs.steps === 20 && sdxlOut["3"].inputs.cfg === 8 && sdxlOut["3"].inputs.sampler_name === "euler", "detect SDXL: other sampler settings are untouched");
ok(fillWorkflow(sdxl, { ...params, checkpoint: "" })["4"].inputs.ckpt_name === "old.safetensors", "detect SDXL: with no checkpoint chosen, the workflow keeps its own");
const fitS = describeWorkflow(sdxl);
ok(fitS.mode === "detected" && fitS.prompt && fitS.negative && fitS.checkpoint && fitS.size && fitS.count && fitS.seed, "describe SDXL: everything is found");
// the nodes may be listed in any order, even with the negative encoder first
const reordered: Workflow = { "7": sdxl["7"], "6": sdxl["6"], "3": sdxl["3"], "4": sdxl["4"], "5": sdxl["5"] };
ok(fillWorkflow(reordered, params)["6"].inputs.text === "a lighthouse at dawn" && fillWorkflow(reordered, params)["7"].inputs.text === "text, watermark", "detect SDXL: the order of the nodes does not matter");

// ---- detection: Flux-style graph ----
const flux: Workflow = {
  "10": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors", weight_dtype: "default" } },
  "11": { class_type: "DualCLIPLoader", inputs: { clip_name1: "t5xxl.safetensors", clip_name2: "clip_l.safetensors", type: "flux" } },
  "12": { class_type: "CLIPTextEncode", inputs: { text: "a cute anime girl", clip: ["11", 0] } },
  "13": { class_type: "FluxGuidance", inputs: { guidance: 3.5, conditioning: ["12", 0] } },
  "14": { class_type: "BasicGuider", inputs: { model: ["10", 0], conditioning: ["13", 0] } },
  "15": { class_type: "RandomNoise", inputs: { noise_seed: 42 } },
  "16": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  "17": { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 20, denoise: 1, model: ["10", 0] } },
  "18": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "19": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["15", 0], guider: ["14", 0], sampler: ["16", 0], sigmas: ["17", 0], latent_image: ["18", 0] } },
  "20": { class_type: "VAEDecode", inputs: { samples: ["19", 0], vae: ["21", 0] } },
  "21": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "22": { class_type: "SaveImage", inputs: { filename_prefix: "flux", images: ["20", 0] } },
};
const fluxOut = fillWorkflow(flux, params);
ok(fluxOut["12"].inputs.text === "a lighthouse at dawn", "detect Flux: the prompt is found through the guider and FluxGuidance");
ok(fluxOut["15"].inputs.noise_seed === 12345, "detect Flux: RandomNoise's noise_seed is set");
ok(fluxOut["18"].inputs.width === 1344 && fluxOut["18"].inputs.height === 768 && fluxOut["18"].inputs.batch_size === 2, "detect Flux: EmptySD3LatentImage's size and batch are set");
ok(fluxOut["10"].inputs.unet_name === "flux1-dev.safetensors" && fluxOut["13"].inputs.guidance === 3.5, "detect Flux: the model loader and guidance are untouched (no checkpoint loader to set)");
ok(JSON.stringify(flux["12"].inputs) === '{"text":"a cute anime girl","clip":["11",0]}', "detect Flux: the original is not changed");
const fitF = describeWorkflow(flux);
ok(fitF.mode === "detected" && fitF.prompt && !fitF.negative && !fitF.checkpoint && fitF.size && fitF.count && fitF.seed, "describe Flux: prompt, size, how many and seed; no negative and no checkpoint");

// ---- detection: CLIPTextEncodeSDXL with text_g / text_l ----
const sdxlDual: Workflow = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x.safetensors" } },
  "2": { class_type: "CLIPTextEncodeSDXL", inputs: { width: 4096, height: 4096, crop_w: 0, crop_h: 0, target_width: 4096, target_height: 4096, text_g: "old g", text_l: "old l", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncodeSDXL", inputs: { width: 4096, height: 4096, crop_w: 0, crop_h: 0, target_width: 4096, target_height: 4096, text_g: "bad g", text_l: "bad l", clip: ["1", 1] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "5": { class_type: "KSamplerAdvanced", inputs: { add_noise: "enable", noise_seed: 7, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", start_at_step: 0, end_at_step: 10000, return_with_leftover_noise: "disable", model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
};
const dualOut = fillWorkflow(sdxlDual, params);
ok(dualOut["2"].inputs.text_g === "a lighthouse at dawn" && dualOut["2"].inputs.text_l === "a lighthouse at dawn", "detect SDXL dual: text_g and text_l both get the prompt");
ok(dualOut["3"].inputs.text_g === "text, watermark" && dualOut["3"].inputs.text_l === "text, watermark", "detect SDXL dual: the negative encoder gets the negative prompt");
ok(dualOut["2"].inputs.width === 4096 && dualOut["5"].inputs.noise_seed === 12345, "detect SDXL dual: the encoder's own size is untouched; KSamplerAdvanced's noise_seed is set");
const fitD = describeWorkflow(sdxlDual);
ok(fitD.mode === "detected" && fitD.prompt && fitD.negative && fitD.checkpoint && fitD.size && fitD.seed, "describe SDXL dual: everything is found");

// ---- a workflow whose texts are not strings (linked from a primitive node) is left alone, not broken ----
const linkedText: Workflow = {
  "1": { class_type: "PrimitiveString", inputs: { value: "hello" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: ["1", 0], clip: ["4", 1] } },
  "3": { class_type: "KSampler", inputs: { seed: 1, positive: ["2", 0], negative: ["2", 0] } },
};
ok(throwsWorkflowError(() => fillWorkflow(linkedText, params)) === null, "a prompt text that is a link doesn't crash filling (it just can't be set)");

// ---- no prompt node ----
const bare: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "x" } },
};
const bareMsg = throwsWorkflowError(() => fillWorkflow(bare, params));
ok(bareMsg !== null && bareMsg.includes("{{prompt}}"), "a workflow with no prompt node is an error that suggests {{prompt}}");
const fitB = describeWorkflow(bare);
ok(fitB.mode === "detected" && !fitB.prompt && !fitB.negative && !fitB.checkpoint && !fitB.size && !fitB.count && !fitB.seed, "describe: a workflow with nothing to set reports nothing");
const orphanEncoder: Workflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "lonely" } }, "2": { class_type: "KSampler", inputs: { seed: 1 } } };
ok(throwsWorkflowError(() => fillWorkflow(orphanEncoder, params)) !== null && !describeWorkflow(orphanEncoder).prompt, "a text encoder not connected to a sampler is not guessed at");

// ---- the same node feeding both inputs is not treated as a negative prompt ----
const same: Workflow = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "shared" } },
  "2": { class_type: "KSampler", inputs: { seed: 1, positive: ["1", 0], negative: ["1", 0] } },
};
const sameOut = fillWorkflow(same, params);
ok(sameOut["1"].inputs.text === "a lighthouse at dawn" && !describeWorkflow(same).negative, "one encoder on both inputs gets the prompt and no negative");

// ---- the file name prefix of the saved pictures ----
const prefix = filenamePrefix("story1", "chap2");
ok(prefix === "StoryTime/story1/chap2", "a chapter's pictures are filed under StoryTime/<story>/<chapter>");
const prefixOf = (wf: Workflow) => Object.values(wf).find((n) => n.class_type === "SaveImage")!.inputs.filename_prefix;
ok(prefixOf(fillWorkflow(BUILTIN_WORKFLOW, { ...params, prefix })) === prefix, "the built-in workflow's StoryTime prefix is replaced");
ok(prefixOf(fillWorkflow(BUILTIN_WORKFLOW, params)) === "StoryTime" && prefixOf(BUILTIN_WORKFLOW) === "StoryTime", "…and kept when no prefix is given, and the built-in workflow itself is unchanged");
const save = (filename_prefix: string): Workflow => ({
  "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix } },
});
ok(prefixOf(fillWorkflow(save("mine/portraits"), { ...params, prefix })) === "mine/portraits", "a prefix of the workflow's own is left alone");
ok(prefixOf(fillWorkflow(save("{{prefix}}"), { ...params, prefix })) === prefix, "{{prefix}} is replaced");
ok(prefixOf(fillWorkflow(save("tales/{{prefix}}/final"), { ...params, prefix })) === `tales/${prefix}/final`, "…also inside longer text");
ok(prefixOf(fillWorkflow(save("{{prefix}}"), params)) === "StoryTime", "{{prefix}} with no prefix given becomes StoryTime, never left as it is");
ok(prefixOf(fillWorkflow(save("StoryTime"), { ...params, prefix })) === prefix, "a placeholder workflow's prefix of StoryTime is replaced too");
const detectedSave: Workflow = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "x" } },
  "2": { class_type: "KSampler", inputs: { seed: 1, positive: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "{{prefix}}" } },
};
const detectedFit = describeWorkflow(detectedSave);
ok(detectedFit.mode === "detected" && detectedFit.prompt, "{{prefix}} alone doesn't turn a workflow into a placeholder one");
ok(prefixOf(fillWorkflow(detectedSave, { ...params, prefix })) === prefix && fillWorkflow(detectedSave, { ...params, prefix })["1"].inputs.text === params.prompt, "…and it is filled in beside the automatic settings");

// ---- starting from a picture (image to image) ----
const imgParams: PictureParams = { ...params, image: "storytime-abc.png", denoise: 0.4 };
const imgBefore = JSON.stringify(BUILTIN_WORKFLOW);
const imgBuilt = fillWorkflow(BUILTIN_WORKFLOW, imgParams);
ok(JSON.stringify(BUILTIN_WORKFLOW) === imgBefore && JSON.stringify(BUILTIN_IMG2IMG).includes("{{image}}"), "img2img builtin: the built-in workflows are not changed by filling");
ok(Object.values(imgBuilt).some((n) => n.class_type === "LoadImage" && n.inputs.image === "storytime-abc.png"), "img2img builtin: a LoadImage node has the uploaded picture's name");
ok(!Object.values(imgBuilt).some((n) => n.class_type === "EmptyLatentImage"), "img2img builtin: there is no empty latent image");
ok(imgBuilt["3"].inputs.denoise === 0.4 && typeof imgBuilt["3"].inputs.denoise === "number", "img2img builtin: the sampler's denoise is the strength, as a number");
ok(JSON.stringify(imgBuilt["3"].inputs.latent_image) === '["12",0]' && JSON.stringify(imgBuilt["12"].inputs.samples) === '["11",0]' && JSON.stringify(imgBuilt["11"].inputs.pixels) === '["10",0]', "img2img builtin: the picture goes LoadImage → VAEEncode → RepeatLatentBatch → sampler");
ok(imgBuilt["12"].inputs.amount === 2 && imgBuilt["3"].inputs.seed === 12345 && imgBuilt["6"].inputs.text === "a lighthouse at dawn" && imgBuilt["4"].inputs.ckpt_name === "sdxl_base.safetensors", "img2img builtin: the batch is the count, and seed, prompt and checkpoint are set");
ok(JSON.stringify(imgBuilt["11"].inputs.vae) === '["4",2]' && JSON.stringify(imgBuilt).includes("{{") === false, "img2img builtin: the checkpoint's VAE encodes, and no placeholder is left");
ok(fillWorkflow(BUILTIN_WORKFLOW, { ...imgParams, denoise: undefined })["3"].inputs.denoise === 1, "img2img builtin: with no strength given, denoise is 1");
ok(fillWorkflow(BUILTIN_WORKFLOW, params)["3"].inputs.denoise === 1 && fillWorkflow(BUILTIN_WORKFLOW, params)["5"].class_type === "EmptyLatentImage", "builtin: with no picture the text-to-image workflow is used, as before");
ok(describeWorkflow(BUILTIN_WORKFLOW).image === true, "describe: the built-in workflow can start from a picture");

const imgPlaceholders: Workflow = {
  "1": { class_type: "KSampler", inputs: { seed: "{{seed}}", denoise: "{{denoise}}", positive: ["2", 0], latent_image: ["6", 0] } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
  "5": { class_type: "LoadImage", inputs: { image: "{{image}}" } },
  "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["7", 0] } },
};
const imgFilled = fillWorkflow(imgPlaceholders, imgParams);
ok(imgFilled["5"].inputs.image === "storytime-abc.png" && imgFilled["1"].inputs.denoise === 0.4 && typeof imgFilled["1"].inputs.denoise === "number", "img2img placeholders: {{image}} is the name and {{denoise}} a number");
ok(describeWorkflow(imgPlaceholders).image === true && describeWorkflow(custom).image === false, "describe: a workflow can start from a picture when it has {{image}}");
const needsPicture = throwsWorkflowError(() => fillWorkflow(imgPlaceholders, params));
ok(needsPicture !== null && needsPicture.includes("choose a picture"), "img2img placeholders: a workflow with {{image}} and no picture chosen is an error saying to choose one");
const noImageSlot = throwsWorkflowError(() => fillWorkflow(custom, imgParams));
ok(noImageSlot !== null && noImageSlot.includes("{{image}}"), "img2img placeholders: starting from a picture with a workflow that has none is an error mentioning {{image}}");
ok(fillWorkflow({ ...custom, "1": { ...custom["1"], inputs: { ...custom["1"].inputs, denoise: "{{denoise}}" } } }, params)["1"].inputs.denoise === 1, "placeholders: {{denoise}} with no picture is 1");

const sdxlImg = fillWorkflow(sdxl, imgParams);
ok(!("5" in sdxlImg) && JSON.stringify(sdxl["5"].class_type) === '"EmptyLatentImage"', "img2img detected: the empty latent image is replaced (in the copy)");
ok(sdxlImg.storytime_image.inputs.image === "storytime-abc.png" && JSON.stringify(sdxlImg.storytime_encode.inputs.vae) === '["4",2]' && sdxlImg.storytime_repeat.inputs.amount === 2, "img2img detected: LoadImage, VAEEncode (with the decoder's VAE) and RepeatLatentBatch are added");
ok(JSON.stringify(sdxlImg["3"].inputs.latent_image) === '["storytime_repeat",0]' && sdxlImg["3"].inputs.denoise === 0.4, "img2img detected: the sampler takes the picture's latent, at the chosen strength");
ok(sdxlImg["6"].inputs.text === "a lighthouse at dawn" && sdxlImg["3"].inputs.seed === 12345, "img2img detected: the prompt and seed are still set");
ok(describeWorkflow(sdxl).image === true && describeWorkflow(bare).image === false, "describe: a detected workflow can start from a picture when it has an empty latent, a VAE and a denoise");
const fluxImg = fillWorkflow(flux, imgParams);
ok(fluxImg["17"].inputs.denoise === 0.4 && JSON.stringify(fluxImg["19"].inputs.latent_image) === '["storytime_repeat",0]' && JSON.stringify(fluxImg.storytime_encode.inputs.vae) === '["21",0]', "img2img detected (Flux): the scheduler's denoise is set and the VAE loader's VAE is used");
const cantStart = throwsWorkflowError(() => fillWorkflow({ ...sdxl, "3": { class_type: "KSampler", inputs: { ...sdxl["3"].inputs, denoise: "x" } } }, imgParams));
ok(cantStart !== null && cantStart.includes("{{image}}"), "img2img detected: a workflow with no numeric denoise is an error pointing to {{image}} and {{denoise}}");

// ---- randomSeed ----
const seeds = Array.from({ length: 50 }, randomSeed);
ok(seeds.every((s) => Number.isInteger(s) && s >= 0 && s < 2 ** 48), "random seeds are whole numbers below 2^48");
ok(new Set(seeds).size > 40, "…and they differ");
