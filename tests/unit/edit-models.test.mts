import { buildEdit, checkEditModels, comboOptions, EDIT_MODELS, EDIT_NODES, editFilesExtras, editFilesText, editKnobs, editModel, editPresetCheck, editSize, editTuning, lightningSteps, presetCheck, usableLoras, type NodeInfo } from "../../src/lib/comfy/editModels.ts";
import type { Workflow } from "../../src/lib/comfy/workflow.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- editSize ----
const square = editSize(96, 96);
ok(square.width === 1024 && square.height === 1024, `a small square picture is edited at 1024 × 1024 (${square.width} × ${square.height})`);
const wide = editSize(1344, 768);
ok(wide.width % 16 === 0 && wide.height % 16 === 0, `sizes are multiples of 16 (${wide.width} × ${wide.height})`);
ok(Math.abs(wide.width * wide.height - 1024 * 1024) / (1024 * 1024) < 0.05, "…at about one megapixel");
ok(Math.abs(wide.width / wide.height - 1344 / 768) < 0.05, "…keeping the picture's shape");
const thin = editSize(4000, 10);
ok(thin.height >= 16, "a very thin picture still gets a usable height");

// ---- comboOptions: both ways ComfyUI writes a list of choices ----
ok(comboOptions({ input: { required: { a: [["x", "y"], {}] } } }, "a").join() === "x,y", "choices as [[…], {…}]");
ok(comboOptions({ input: { required: { a: ["COMBO", { options: ["x"] }] } } }, "a").join() === "x", "choices as COMBO with options");
ok(comboOptions({ input: { optional: { a: [["z"]] } } }, "a").join() === "z", "…also among the optional inputs");
ok(comboOptions(null, "a").length === 0 && comboOptions({ input: { required: { a: ["INT", {}] } } }, "a").length === 0, "no choices for a missing node or a number input");

// ---- checkEditModels ----
/** What ComfyUI would say about every node the check asks about, with these files installed. */
function info(files: { unet?: string[]; clip?: string[]; vae?: string[]; lora?: string[]; ckpt?: string[] }, missing: string[] = [], clipTypes = ["qwen_image"], dualTypes = ["flux"]): Record<string, NodeInfo> {
  const loaders: Record<string, Record<string, unknown>> = {
    LoraLoaderModelOnly: { lora_name: [files.lora ?? [], {}], strength_model: ["FLOAT", {}] },
    UNETLoader: { unet_name: [files.unet ?? [], {}] },
    CLIPLoader: { clip_name: [files.clip ?? [], {}], type: [clipTypes, {}] },
    DualCLIPLoader: { clip_name1: ["COMBO", { options: files.clip ?? [] }], clip_name2: ["COMBO", { options: files.clip ?? [] }], type: ["COMBO", { options: dualTypes }] },
    VAELoader: { vae_name: [files.vae ?? [], {}] },
    CheckpointLoaderSimple: { ckpt_name: [files.ckpt ?? [], {}] },
  };
  return Object.fromEntries(EDIT_NODES.map((n) => [n, missing.includes(n) ? null : { input: { required: loaders[n] ?? {} } }]));
}
const all = {
  unet: ["qwen_image_edit_2509_fp8_e4m3fn.safetensors", "flux1-dev-kontext_fp8_scaled.safetensors", "other.safetensors"],
  clip: ["qwen_2.5_vl_7b_fp8_scaled.safetensors", "clip_l.safetensors", "t5xxl_fp8_e4m3fn_scaled.safetensors"],
  vae: ["qwen_image_vae.safetensors", "ae.safetensors"],
};
const byId = (checks: ReturnType<typeof checkEditModels>, id: string) => checks.find((c) => c.model.id === id)!;

let checks = checkEditModels(info({}));
ok(checks.length === EDIT_MODELS.length && checks.every((c) => !c.ready && c.parts.every((p) => p.file === null)), "with no files, no edit model is ready and every part is missing");

checks = checkEditModels(info(all));
ok(checks.every((c) => c.ready && c.missingNodes.length === 0), "with every file and node, both are ready");
ok(byId(checks, "qwen-image-edit").files.model === "qwen_image_edit_2509_fp8_e4m3fn.safetensors" && byId(checks, "flux-kontext").files.t5 === "t5xxl_fp8_e4m3fn_scaled.safetensors", "…and each part has its file");

checks = checkEditModels(info({ ...all, unet: ["Qwen-Image-Edit-2511-bf16.safetensors", "kontext/my_kontext_q8.safetensors"], vae: ["qwen_image_vae.safetensors", "flux/ae.safetensors"] }));
ok(byId(checks, "qwen-image-edit").files.model === "Qwen-Image-Edit-2511-bf16.safetensors", "another release or precision of the model is found by its name");
ok(byId(checks, "flux-kontext").files.model === "kontext/my_kontext_q8.safetensors" && byId(checks, "flux-kontext").files.vae === "flux/ae.safetensors", "…including in a subfolder");

checks = checkEditModels(info({ ...all, unet: ["flux1-dev-kontext_fp8_scaled.safetensors"] }));
ok(!byId(checks, "qwen-image-edit").ready && byId(checks, "flux-kontext").ready, "one model's missing file only stops that model");
ok(byId(checks, "qwen-image-edit").parts.find((p) => p.part.key === "model")?.file === null, "…and says which part is missing");

checks = checkEditModels(info(all, ["TextEncodeQwenImageEditPlus"]));
ok(!byId(checks, "qwen-image-edit").ready && byId(checks, "qwen-image-edit").missingNodes.join() === "TextEncodeQwenImageEditPlus" && byId(checks, "flux-kontext").ready, "a missing node stops the model that needs it, and says which");

checks = checkEditModels(info(all, [], ["stable_diffusion"]));
ok(!byId(checks, "qwen-image-edit").ready && byId(checks, "qwen-image-edit").missingOptions[0] === "CLIPLoader type: qwen_image", "a CLIP loader without the qwen_image type (an old ComfyUI) stops Qwen");

checks = checkEditModels(info({ ...all, vae: ["ae.safetensors"], clip: ["clip_l.safetensors", "t5xxl_fp16.safetensors"] }));
ok(byId(checks, "flux-kontext").ready && byId(checks, "flux-kontext").files.t5 === "t5xxl_fp16.safetensors", "the T5 encoder can be another precision");
ok(!byId(checks, "flux-kontext").files.clipL?.includes("t5"), "…and the CLIP-L part isn't taken by the T5 file");

// ---- the workflows ----
const nodes = (wf: Workflow, type: string) => Object.values(wf).filter((n) => n.class_type === type);
const params = { image: "storytime-start-1.png", instruction: "remove the logo on his shirt", seed: 99, count: 2, width: 1280, height: 816, prefix: "StoryTime/s/c", denoise: 1 };
const ready = checkEditModels(info(all));
for (const check of ready) {
  const wf = check.model.build(check.files, params);
  const links = Object.values(wf).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v) && typeof v[0] === "string"));
  ok(links.every(([id]) => id in wf), `${check.model.name}: every link points at a node in the workflow`);
  ok(check.model.nodes.every((n) => nodes(wf, n).length > 0) && Object.values(wf).every((n) => check.model.nodes.includes(n.class_type)), `${check.model.name}: the nodes it lists are the ones it uses`);
  ok(nodes(wf, "LoadImage")[0].inputs.image === params.image, `${check.model.name}: it loads the starting picture`);
  const scale = nodes(wf, "ImageScale")[0].inputs;
  ok(scale.width === 1280 && scale.height === 816, `${check.model.name}: …scaled to the edit size`);
  ok(nodes(wf, "RepeatLatentBatch")[0].inputs.amount === 2 && nodes(wf, "KSampler")[0].inputs.seed === 99 && nodes(wf, "KSampler")[0].inputs.denoise === 1, `${check.model.name}: the count and seed are set, and the sampler starts from noise`);
  ok(nodes(wf, "SaveImage")[0].inputs.filename_prefix === "StoryTime/s/c", `${check.model.name}: the pictures are filed under the chapter`);
  ok(nodes(wf, "UNETLoader")[0].inputs.unet_name === check.files.model, `${check.model.name}: it loads the model file that was found`);
  ok(JSON.stringify(wf).includes(params.instruction), `${check.model.name}: the instruction is in it`);
}
for (const check of ready) {
  const part = check.model.build(check.files, { ...params, denoise: 0.6 });
  ok(nodes(part, "KSampler")[0].inputs.denoise === 0.6, `${check.model.name}: a lower strength is the sampler's denoise`);
}
const qwen = byId(ready, "qwen-image-edit").model.build(byId(ready, "qwen-image-edit").files, params);
const encoders = nodes(qwen, "TextEncodeQwenImageEditPlus");
ok(encoders.length === 2 && encoders.some((n) => n.inputs.prompt === params.instruction) && encoders.some((n) => n.inputs.prompt === ""), "Qwen: one encoder has the instruction, the negative one is empty");
ok(encoders.every((n) => JSON.stringify(n.inputs.image1) === JSON.stringify(["11", 0])), "…and both see the scaled picture");
ok(nodes(qwen, "CLIPLoader")[0].inputs.type === "qwen_image", "…with the text encoder loaded as qwen_image");
const kontext = byId(ready, "flux-kontext").model.build(byId(ready, "flux-kontext").files, params);
ok(nodes(kontext, "ReferenceLatent").length === 1 && nodes(kontext, "CLIPTextEncode")[0].inputs.text === params.instruction, "Kontext: the picture is a reference latent and the instruction is the prompt");
ok(nodes(kontext, "DualCLIPLoader")[0].inputs.type === "flux" && nodes(kontext, "KSampler")[0].inputs.cfg === 1, "…with the flux text encoders, at CFG 1");

ok(editModel("flux-kontext")?.name === "FLUX.1 Kontext" && editModel("nope") === undefined, "editModel finds a model by id");

// ---- the Lightning LoRA (Qwen's optional speed-up) ----
ok(lightningSteps("Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors") === 4 && lightningSteps("loras/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-fp32.safetensors") === 8, "the steps come from the LoRA's file name");
ok(lightningSteps("qwen_image_edit_lightning.safetensors") === 8 && lightningSteps("Qwen-Image-Edit-Lightning_6_step.safetensors") === 6, "…8 when the name doesn't say, and other spellings work");

checks = checkEditModels(info(all));
ok(byId(checks, "qwen-image-edit").ready && byId(checks, "qwen-image-edit").speedUp?.file === null && !("speedUp" in byId(checks, "qwen-image-edit").files), "without the LoRA, Qwen is still ready, with no speed-up");
ok(byId(checks, "flux-kontext").speedUp === null, "Kontext has no speed-up");
const lightning4 = "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors";
const loras = [ "Qwen-Image-Lightning-8steps-V1.1.safetensors", "Qwen-Image-Edit-Lightning-8steps-V1.0.safetensors", `qwen/${lightning4}`, "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"];
checks = checkEditModels(info({ ...all, lora: loras }));
ok(byId(checks, "qwen-image-edit").files.speedUp === `qwen/${lightning4}`, "with the LoRAs installed, the one for the 2509 model is used (not Qwen-Image's or another release's)");
checks = checkEditModels(info({ ...all, unet: ["qwen_image_edit_2511_bf16.safetensors"], lora: loras }));
ok(byId(checks, "qwen-image-edit").files.speedUp === "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "…and with a 2511 model, the 2511 LoRA");
checks = checkEditModels(info({ ...all, lora: ["Qwen-Image-Lightning-8steps-V1.1.safetensors"] }));
ok(byId(checks, "qwen-image-edit").speedUp?.file === null, "Qwen-Image's own Lightning LoRA (not the edit one) isn't taken");
checks = checkEditModels(info({ unet: ["flux1-dev-kontext_fp8_scaled.safetensors"], clip: all.clip, vae: all.vae, lora: [lightning4] }));
ok(!byId(checks, "qwen-image-edit").ready && byId(checks, "qwen-image-edit").speedUp?.file === lightning4 && !byId(checks, "qwen-image-edit").files.speedUp, "the LoRA alone doesn't make Qwen ready");

checks = checkEditModels(info({ ...all, lora: [lightning4] }));
const q = byId(checks, "qwen-image-edit");
const slow = q.model.build(q.files, params);
const fast = q.model.build(q.files, params, true);
ok(nodes(slow, "LoraLoaderModelOnly").length === 0 && nodes(slow, "KSampler")[0].inputs.steps === 20 && nodes(slow, "KSampler")[0].inputs.cfg === 2.5, "without fast, Qwen runs 20 steps at CFG 2.5 and no LoRA");
const lora = nodes(fast, "LoraLoaderModelOnly")[0];
ok(lora?.inputs.lora_name === lightning4 && lora.inputs.strength_model === 1 && JSON.stringify(lora.inputs.model) === JSON.stringify(["1", 0]), "fast loads the LoRA onto the model");
ok(JSON.stringify(nodes(fast, "ModelSamplingAuraFlow")[0].inputs.model) === JSON.stringify(["9", 0]), "…which the sampling nodes then use");
ok(nodes(fast, "KSampler")[0].inputs.steps === 4 && nodes(fast, "KSampler")[0].inputs.cfg === 1, "…at the LoRA's 4 steps and CFG 1");
const fastLinks = Object.values(fast).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v) && typeof v[0] === "string"));
ok(fastLinks.every(([id]) => id in fast), "…and every link points at a node in the workflow");
const noLora = byId(checkEditModels(info(all)), "qwen-image-edit");
ok(nodes(noLora.model.build(noLora.files, params, true), "LoraLoaderModelOnly").length === 0, "fast without the LoRA installed is the ordinary workflow");
ok(editFilesText(q, true) === `qwen_image_edit_2509_fp8_e4m3fn.safetensors + ${lightning4}` && editFilesText(q, false) === "qwen_image_edit_2509_fp8_e4m3fn.safetensors" && editFilesText(noLora, true) === "qwen_image_edit_2509_fp8_e4m3fn.safetensors", "the job log keeps the LoRA's file beside the model's only when it is used");
ok(EDIT_NODES.includes("LoraLoaderModelOnly") && !q.model.nodes.includes("LoraLoaderModelOnly"), "the check asks about the LoRA loader, but Qwen doesn't need it to be ready");

// ---- the author's LoRA stack ----
const userLoras = ["styles/ink.safetensors", "hero.safetensors"];
checks = checkEditModels(info({ ...all, lora: [lightning4, ...userLoras] }));
ok(checks.every((c) => c.loras.join() === [lightning4, ...userLoras].join()), "each check lists every LoRA ComfyUI has, for the stacks");
ok(byId(checkEditModels(info({ ...all, lora: userLoras }, ["LoraLoaderModelOnly"])), "flux-kontext").loras.length === 0, "…and none when ComfyUI has no LoRA loader");
const stack = [{ name: "styles/ink.safetensors", strength: 0.8 }, { name: "hero.safetensors", strength: -0.5 }];
const chainOf = (wf: Workflow) => {
  // From the sampler's model back to the model loader, through the LoRA loaders.
  const out: string[] = [];
  let link = (Object.values(wf).find((n) => n.class_type === "ModelSamplingAuraFlow") ?? nodes(wf, "KSampler")[0]).inputs.model as [string, number];
  while (wf[link[0]].class_type === "LoraLoaderModelOnly") {
    out.unshift(`${wf[link[0]].inputs.lora_name}@${wf[link[0]].inputs.strength_model}`);
    link = wf[link[0]].inputs.model as [string, number];
  }
  return { loras: out, from: wf[link[0]].class_type };
};
const qs = byId(checks, "qwen-image-edit");
let c = chainOf(qs.model.build(qs.files, { ...params, loras: stack }));
ok(c.loras.join() === "styles/ink.safetensors@0.8,hero.safetensors@-0.5" && c.from === "UNETLoader", "Qwen applies the stack in order, at each strength, onto the model");
c = chainOf(qs.model.build(qs.files, { ...params, loras: stack }, true));
ok(c.loras.join() === `${lightning4}@1,styles/ink.safetensors@0.8,hero.safetensors@-0.5`, "…after the Lightning LoRA when fast");
const fastStack = qs.model.build(qs.files, { ...params, loras: stack }, true);
ok(nodes(fastStack, "KSampler")[0].inputs.steps === 4, "…which still sets the steps");
const ks = byId(checks, "flux-kontext");
const kStack = ks.model.build(ks.files, { ...params, loras: stack });
c = chainOf(kStack);
ok(c.loras.join() === "styles/ink.safetensors@0.8,hero.safetensors@-0.5" && c.from === "UNETLoader", "Kontext applies the stack too, before its sampler");
const kLinks = Object.values(kStack).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v) && typeof v[0] === "string"));
ok(kLinks.every(([id]) => id in kStack), "…and every link points at a node in the workflow");
ok(nodes(ks.model.build(ks.files, { ...params, loras: [] }), "LoraLoaderModelOnly").length === 0, "an empty stack adds no nodes");

ok(
  editFilesText(qs, true, stack) === `qwen_image_edit_2509_fp8_e4m3fn.safetensors + ${lightning4} + styles/ink.safetensors (0.8) + hero.safetensors (-0.5)`,
  "the job log keeps the model, the speed-up and each LoRA with its strength",
);
ok(JSON.stringify(editFilesExtras("qwen-image-edit", editFilesText(qs, true, stack))) === '{"fast":true,"loras":2}', "…from which the caption reads fast and 2 LoRAs");
ok(JSON.stringify(editFilesExtras("qwen-image-edit", editFilesText(qs, false, stack))) === '{"fast":false,"loras":2}', "…not fast without the speed-up");
ok(JSON.stringify(editFilesExtras("qwen-image-edit", `m.safetensors + ${lightning4}`)) === '{"fast":true,"loras":0}', "…and jobs logged before stacks still read as fast");
ok(JSON.stringify(editFilesExtras("flux-kontext", "k.safetensors + a (1).safetensors (1)")) === '{"fast":false,"loras":1}', "…even with brackets in a LoRA's file name");

const u = usableLoras(
  [{ name: "styles/ink.safetensors", strength: 0.8, on: true }, { name: "gone.safetensors", strength: 1, on: true }, { name: "hero.safetensors", strength: 1, on: false }, { name: "", strength: 1, on: true }],
  userLoras,
);
ok(JSON.stringify(u.loras) === '[{"name":"styles/ink.safetensors","strength":0.8}]' && u.missing.join() === "gone.safetensors", "an edit uses the LoRAs switched on that ComfyUI has, and names the missing ones");

// ---- each model's settings (Settings › Pictures › Advanced) ----
const qm = editModel("qwen-image-edit")!;
const km = editModel("flux-kontext")!;
ok(editKnobs(qm).join() === "shift" && editKnobs(km).join() === "guidance", "Qwen has a shift setting and Kontext a guidance one");
ok(JSON.stringify(editTuning(qm)) === JSON.stringify(qm.defaults) && qm.defaults.steps === 20 && qm.defaults.cfg === 2.5 && qm.defaults.strength === 1, "with nothing changed, a model runs with its defaults");
const qt = editTuning(qm, { steps: 28, cfg: 3, sampler: "res_multistep", shift: 2, guidance: 9 });
ok(qt.steps === 28 && qt.cfg === 3 && qt.sampler === "res_multistep" && qt.scheduler === "simple" && qt.shift === 2 && qt.guidance === undefined, "changed settings replace the defaults, and one the model doesn't have is ignored");
const qwf = qm.build(qs.files, { ...params, tuning: qt });
const qk = nodes(qwf, "KSampler")[0].inputs;
ok(qk.steps === 28 && qk.cfg === 3 && qk.sampler_name === "res_multistep" && qk.scheduler === "simple", "Qwen's workflow uses them");
ok(nodes(qwf, "ModelSamplingAuraFlow")[0].inputs.shift === 2, "…including the shift");
const qfast = nodes(qm.build(qs.files, { ...params, tuning: qt }, true), "KSampler")[0].inputs;
ok(qfast.steps === 4 && qfast.cfg === 1 && qfast.sampler_name === "res_multistep", "Fast still uses the Lightning LoRA's steps at CFG 1, with the chosen sampler");
ok(nodes(qm.build(qs.files, params), "KSampler")[0].inputs.steps === 20 && nodes(qm.build(qs.files, params), "ModelSamplingAuraFlow")[0].inputs.shift === 3, "without settings, Qwen's workflow is as before");
const kwf = km.build(ks.files, { ...params, tuning: editTuning(km, { guidance: 4, steps: 24, scheduler: "beta" }) });
ok(nodes(kwf, "FluxGuidance")[0].inputs.guidance === 4 && nodes(kwf, "KSampler")[0].inputs.steps === 24 && nodes(kwf, "KSampler")[0].inputs.scheduler === "beta", "Kontext's workflow uses its guidance and sampler settings");
ok(nodes(km.build(ks.files, params), "FluxGuidance")[0].inputs.guidance === 2.5, "…and guidance 2.5 without them");

const withSamplers = { ...info(all), KSampler: { input: { required: { sampler_name: [["euler", "dpmpp_2m"], {}], scheduler: ["COMBO", { options: ["simple", "karras"] }] } } } };
const sc = checkEditModels(withSamplers)[0];
ok(sc.samplers.join() === "euler,dpmpp_2m" && sc.schedulers.join() === "simple,karras", "the check lists the samplers and schedulers ComfyUI's KSampler offers, for Settings");
ok(EDIT_NODES.includes("KSampler"), "…which it asks about anyway");

// ---- presetCheck and buildEdit: files a preset chooses ----
{
  const aio = "Qwen-Rapid-AIO-NSFW-v19.safetensors";
  const tuned = "my-uncensored-edit.safetensors";
  const abl = "qwen25vl-abliterated.safetensors";
  const base = byId(checkEditModels(info({ ...all, unet: [...all.unet, tuned], clip: [...all.clip, abl], ckpt: [aio], lora: [lightning4] })), "qwen-image-edit");
  ok(base.checkpoints.join() === aio && base.parts[0].choices.includes(tuned), "the check lists every checkpoint and every file of each part's folder, for Settings");
  ok(EDIT_NODES.includes("CheckpointLoaderSimple"), "…asking ComfyUI about the checkpoint loader too");

  const own = presetCheck(base, { checkpoint: "", files: { model: tuned, textEncoder: abl } });
  ok(own.ready && own.files.model === tuned && own.files.textEncoder === abl && own.files.vae === "qwen_image_vae.safetensors", "a preset's chosen files replace the ones found by name; the rest are still found");
  const ownWf = buildEdit(own, params);
  ok(nodes(ownWf, "UNETLoader")[0].inputs.unet_name === tuned && nodes(ownWf, "CLIPLoader")[0].inputs.clip_name === abl, "…and its workflow loads them");
  ok(editFilesText(own, false) === tuned, "…and the log records the chosen model");

  const gone = presetCheck(base, { checkpoint: "", files: { model: "deleted.safetensors" } });
  ok(!gone.ready && gone.parts[0].chosen === "deleted.safetensors" && gone.parts[0].file === null, "a chosen file ComfyUI doesn't list makes the preset not ready, and says which");

  const ck = presetCheck(base, { checkpoint: aio, files: { model: tuned } });
  ok(ck.ready && ck.files.checkpoint === aio && !("model" in ck.files) && !("textEncoder" in ck.files) && !("vae" in ck.files), "with an all-in-one checkpoint, the model, text encoder and VAE are the checkpoint's");
  ok(ck.parts.every((p) => p.fromCheckpoint), "…which the check says");
  const ckWf = buildEdit(ck, params, true);
  const loader = Object.entries(ckWf).find(([, n]) => n.class_type === "CheckpointLoaderSimple")!;
  ok(loader[0] === "1" && loader[1].inputs.ckpt_name === aio && nodes(ckWf, "UNETLoader").length === 0 && nodes(ckWf, "CLIPLoader").length === 0 && nodes(ckWf, "VAELoader").length === 0, "…and the workflow loads the checkpoint instead of the three files");
  const refs = Object.values(ckWf).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v)));
  ok(refs.every(([id]) => id in ckWf), "…with every link pointing at a node that exists");
  ok(nodes(ckWf, "TextEncodeQwenImageEditPlus").every((n) => JSON.stringify(n.inputs.clip) === '["1",1]' && JSON.stringify(n.inputs.vae) === '["1",2]'), "…the text encoder and VAE being the checkpoint's outputs");
  ok(nodes(ckWf, "LoraLoaderModelOnly")[0].inputs.model[0] === "1", "…and Fast's LoRA still goes on its model");
  ok(editFilesText(ck, true).startsWith(aio + " + "), "the log records the checkpoint");

  const ckEnc = presetCheck(base, { checkpoint: aio, files: { textEncoder: abl } });
  const ckEncWf = buildEdit(ckEnc, params);
  ok(ckEnc.ready && nodes(ckEncWf, "CLIPLoader")[0].inputs.clip_name === abl && nodes(ckEncWf, "TextEncodeQwenImageEditPlus")[0].inputs.vae[0] === "1", "a checkpoint can be used with a text encoder of its own; the VAE stays the checkpoint's");
  ok(!presetCheck(base, { checkpoint: "missing.safetensors", files: {} }).ready, "a checkpoint ComfyUI doesn't list makes the preset not ready");

  const kbase = byId(checkEditModels(info({ ...all, ckpt: [aio] })), "flux-kontext");
  const kck = presetCheck(kbase, { checkpoint: aio, files: { t5: "t5xxl_fp8_e4m3fn_scaled.safetensors" } });
  const kwf2 = buildEdit(kck, params);
  ok(kck.ready && kck.files.clipL === "clip_l.safetensors" && nodes(kwf2, "DualCLIPLoader").length === 1 && nodes(kwf2, "VAELoader").length === 0, "Flux: choosing one text encoder keeps both on their own loader (the other found by name); the VAE is the checkpoint's");
  ok(editPresetCheck(checkEditModels(info(all)), { model: "flux-kontext", checkpoint: "", files: {} })?.ready === true, "editPresetCheck finds the preset's model");
}
