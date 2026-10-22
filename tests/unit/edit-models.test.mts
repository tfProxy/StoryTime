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
  // ComfyUI-GGUF's loaders aren't there unless a test adds them (see ggufInfo).
  return Object.fromEntries(EDIT_NODES.map((n) => [n, missing.includes(n) || n.endsWith("GGUF") ? null : { input: { required: loaders[n] ?? {} } }]));
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

// ---- reference pictures for an edit ----
{
  const plain = qm.build(qs.files, params);
  ok(nodes(plain, "TextEncodeQwenImageEditPlus").every((n) => !("image2" in n.inputs)) && nodes(plain, "LoadImage").length === 1, "without references, Qwen's encoders get only image 1");
  const wf = qm.build(qs.files, { ...params, refs: ["ref-a.png", "ref-b.png", "ref-c.png"] });
  const encoders = nodes(wf, "TextEncodeQwenImageEditPlus");
  const loaded = (link: unknown) => (wf[(link as [string, number])[0]].inputs as { image?: string }).image;
  ok(encoders.length === 2 && encoders.every((e) => loaded(e.inputs.image2) === "ref-a.png" && loaded(e.inputs.image3) === "ref-b.png" && !("image4" in e.inputs)), "Qwen takes at most two references, as images 2 and 3 of both text encoders");
  ok(encoders.every((e) => (e.inputs.image1 as [string, number])[0] === "11"), "…and the starting picture stays image 1");
  const one = qm.build(qs.files, { ...params, refs: ["ref-a.png"] });
  ok(nodes(one, "TextEncodeQwenImageEditPlus").every((e) => "image2" in e.inputs && !("image3" in e.inputs)), "one reference is only image 2");

  const kplain = km.build(ks.files, params);
  ok(nodes(kplain, "ReferenceLatent").length === 1, "without references, Kontext has one reference latent");
  const kref = km.build(ks.files, { ...params, refs: ["ref-a.png", "ref-b.png"] });
  const latents = nodes(kref, "ReferenceLatent");
  ok(latents.length === 2, "Kontext takes one reference as a second reference latent");
  const second = latents.find((n) => (n.inputs.conditioning as [string, number])[0] !== "4")!;
  const scaled = kref[(second.inputs.latent as [string, number])[0]];
  ok(scaled.class_type === "VAEEncode" && kref[(scaled.inputs.pixels as [string, number])[0]].class_type === "ImageScale", "…encoded from the reference scaled to the size");
  const scale = kref[(scaled.inputs.pixels as [string, number])[0]];
  ok(scale.inputs.width === params.width && scale.inputs.height === params.height && (kref[(scale.inputs.image as [string, number])[0]].inputs as { image: string }).image === "ref-a.png", "…the first reference only, at the edit's size");
  const guide = nodes(kref, "FluxGuidance")[0];
  ok(guide.inputs.conditioning instanceof Array && kref[(guide.inputs.conditioning as [string, number])[0]] === second, "…chained before the guidance");

  const said = (n: { inputs: Record<string, unknown> }) => String(n.inputs.prompt ?? n.inputs.text);
  ok(encoders.every((e) => said(e) !== params.instruction || e.inputs.prompt === "") && encoders.some((e) => said(e).startsWith("Edit image 1") && said(e).includes("images 2 and 3 only as a reference") && said(e).endsWith(params.instruction)), "Qwen's instruction says image 1 is edited and images 2 and 3 are only references");
  ok(said(nodes(one, "TextEncodeQwenImageEditPlus")[0]).includes("image 2 only as a reference"), "…naming only image 2 with one reference");
  ok(said(nodes(kref, "CLIPTextEncode")[0]).startsWith("Edit the first picture") && said(nodes(kref, "CLIPTextEncode")[0]).endsWith(params.instruction), "Kontext's instruction says the first picture is edited and the second only a reference");
  ok(said(nodes(plain, "TextEncodeQwenImageEditPlus")[0]) === params.instruction && said(nodes(kplain, "CLIPTextEncode")[0]) === params.instruction, "without references the instruction is sent as written");
}

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

// ---- GGUF files (the ComfyUI-GGUF loaders) ----
{
  const qGguf = "Qwen-Image-Edit-2509-Q4_K_M.gguf";
  const rapid = "Qwen-Image-Edit-Rapid-AIO-v11-Q4_0.gguf";
  const kGguf = "flux1-kontext-dev-Q4_K_S.gguf";
  const t5Gguf = "t5-v1_1-xxl-encoder-Q5_K_M.gguf";
  const vlGguf = "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf";
  const normal = { unet: [] as string[], clip: ["clip_l.safetensors", "qwen_2.5_vl_7b_fp8_scaled.safetensors"], vae: all.vae };
  /** ComfyUI with the ComfyUI-GGUF nodes: their loaders list the .gguf files (and the rest of the folder, as the real ones do). */
  function ggufInfo(files: { unet?: string[]; clip?: string[]; vae?: string[]; lora?: string[] }, withGguf = true, deviceInGguf = false): Record<string, NodeInfo> {
    const plain = (xs: string[] = []) => xs.filter((x) => !x.endsWith(".gguf"));
    const base = info({ ...files, unet: plain(files.unet), clip: plain(files.clip) });
    const device = (options: string[]) => ({ device: [options, {}] });
    base.CLIPLoader = { input: { required: { clip_name: [plain(files.clip), {}], type: [["qwen_image"], {}] }, optional: device(["default", "cpu"]) } };
    base.DualCLIPLoader = { input: { required: { clip_name1: ["COMBO", { options: plain(files.clip) }], clip_name2: ["COMBO", { options: plain(files.clip) }], type: ["COMBO", { options: ["flux"] }] }, optional: device(["default", "cpu"]) } };
    base.UnetLoaderGGUF = withGguf ? { input: { required: { unet_name: [files.unet ?? [], {}] } } } : null;
    base.CLIPLoaderGGUF = withGguf ? { input: { required: { clip_name: [files.clip ?? [], {}], type: [["qwen_image"], {}] }, optional: deviceInGguf ? device(["default", "cpu"]) : {} } } : null;
    base.DualCLIPLoaderGGUF = withGguf ? { input: { required: { clip_name1: ["COMBO", { options: files.clip ?? [] }], clip_name2: ["COMBO", { options: files.clip ?? [] }], type: ["COMBO", { options: ["flux"] }] } } } : null;
    return base;
  }
  const choose = (check: ReturnType<typeof checkEditModels>[number], files: Record<string, string>, checkpoint = "") => presetCheck(check, { checkpoint, files });
  const fileInputs = (wf: Workflow, id: string) => Object.keys(wf[id].inputs).sort().join();

  ok(EDIT_NODES.includes("UnetLoaderGGUF") && EDIT_NODES.includes("CLIPLoaderGGUF") && EDIT_NODES.includes("DualCLIPLoaderGGUF"), "the check asks ComfyUI about the GGUF loaders");
  ok(EDIT_MODELS.every((m) => !m.nodes.some((n) => n.includes("GGUF"))), "…but no model needs them to be ready");

  // Without ComfyUI-GGUF, nothing changes, and the report can say so.
  let g = checkEditModels(ggufInfo({ unet: [qGguf], clip: normal.clip, vae: normal.vae }, false));
  ok(!byId(g, "qwen-image-edit").ready && byId(g, "qwen-image-edit").ggufMissing.length === 2 && byId(g, "flux-kontext").ggufMissing.length === 2, "without the GGUF nodes, a .gguf file isn't listed, and the check names the loaders that are missing");
  ok(byId(checkEditModels(info(all)), "qwen-image-edit").ggufMissing.length === 2 && byId(checkEditModels(info(all)), "qwen-image-edit").ready, "…which doesn't stop a model that uses safetensors files");

  // Choices are both loaders' lists, once each.
  g = checkEditModels(ggufInfo({ unet: [...all.unet, qGguf, rapid, kGguf], clip: [...normal.clip, vlGguf, t5Gguf], vae: normal.vae }));
  let q = byId(g, "qwen-image-edit");
  ok(q.ggufMissing.length === 0 && q.parts[0].choices.includes(qGguf) && q.parts[0].choices.includes("other.safetensors") && new Set(q.parts[0].choices).size === q.parts[0].choices.length, "a part's choices are the loader's files and the GGUF loader's, without repeats");
  ok(q.parts[1].choices.includes(vlGguf) && q.parts[1].choices.includes("qwen_2.5_vl_7b_fp8_scaled.safetensors"), "…text encoders too");

  // The recommended safetensors file is still preferred; names are found.
  ok(q.ready && q.files.model === "qwen_image_edit_2509_fp8_e4m3fn.safetensors", "with the recommended file there, it is used rather than a GGUF one");
  g = checkEditModels(ggufInfo({ unet: [qGguf, kGguf], clip: [...normal.clip], vae: normal.vae }));
  q = byId(g, "qwen-image-edit");
  ok(q.ready && q.files.model === qGguf, "a GGUF model alone is found by its name (Qwen-Image-Edit-…-Q4_K_M.gguf)");
  g = checkEditModels(ggufInfo({ unet: [rapid], clip: normal.clip, vae: normal.vae }));
  ok(byId(g, "qwen-image-edit").files.model === rapid, "…also a Rapid AIO quant");
  ok(byId(checkEditModels(ggufInfo({ unet: ["Qwen-Rapid-AIO-NSFW-v22-Q4_0.gguf"], clip: normal.clip, vae: normal.vae })), "qwen-image-edit").ready, "…whatever it is called, as long as it says Qwen and Rapid AIO");
  g = checkEditModels(ggufInfo({ unet: [kGguf, "other.gguf"], clip: [...normal.clip, t5Gguf, "t5xxl_fp16.safetensors", vlGguf, "Qwen2.5-VL-7B-Instruct-mmproj-F16.gguf"], vae: normal.vae }));
  const kn = byId(g, "flux-kontext");
  ok(kn.ready && kn.files.model === kGguf && kn.files.t5 === "t5xxl_fp16.safetensors", "Kontext: a GGUF model is found, and a safetensors T5 is preferred to a GGUF one");
  ok(byId(g, "qwen-image-edit").parts[1].file === "qwen_2.5_vl_7b_fp8_scaled.safetensors", "…and so is Qwen's text encoder");
  g = checkEditModels(ggufInfo({ unet: [qGguf], clip: [vlGguf, "Qwen2.5-VL-7B-Instruct-mmproj-F16.gguf"], vae: normal.vae }));
  ok(byId(g, "qwen-image-edit").files.textEncoder === vlGguf, "a GGUF text encoder is found, but not the mmproj file that goes beside it");
  ok(lightningSteps("x") === 8 && byId(checkEditModels(ggufInfo({ unet: [qGguf], clip: normal.clip, vae: normal.vae, lora: [lightning4, "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"] })), "qwen-image-edit").files.speedUp === lightning4, "the Lightning LoRA is the 2509 one for a 2509 GGUF model…");
  ok(byId(checkEditModels(ggufInfo({ unet: ["Qwen-Image-Edit-2511-Q4_K_S.gguf"], clip: normal.clip, vae: normal.vae, lora: [lightning4, "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"] })), "qwen-image-edit").files.speedUp === "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "…and the 2511 one for a 2511 GGUF model");

  // Building: Qwen with a GGUF model and a GGUF text encoder, a LoRA stack and Fast.
  g = checkEditModels(ggufInfo({ unet: [qGguf], clip: [vlGguf, ...normal.clip], vae: normal.vae, lora: [lightning4, "styles/ink.safetensors"] }));
  q = choose(byId(g, "qwen-image-edit"), { model: qGguf, textEncoder: vlGguf });
  let wf = buildEdit(q, { ...params, loras: [{ name: "styles/ink.safetensors", strength: 0.8 }], textEncoderDevice: "cpu" }, true);
  ok(q.ready && nodes(wf, "UNETLoader").length === 0 && nodes(wf, "UnetLoaderGGUF")[0].inputs.unet_name === qGguf, "a .gguf model is loaded by UnetLoaderGGUF");
  ok(fileInputs(wf, "1") === "unet_name", "…without the inputs it doesn't list (weight_dtype)");
  ok(nodes(wf, "CLIPLoader").length === 0 && nodes(wf, "CLIPLoaderGGUF")[0].inputs.clip_name === vlGguf && nodes(wf, "CLIPLoaderGGUF")[0].inputs.type === "qwen_image", "…and a .gguf text encoder by CLIPLoaderGGUF, with its type");
  ok(!("device" in wf["2"].inputs) && q.devices.length === 0, "…whose missing device choice is dropped, and the check says it can't be set");
  ok(chainOf(wf).loras.join() === `${lightning4}@1,styles/ink.safetensors@0.8` && chainOf(wf).from === "UnetLoaderGGUF", "the LoRA chain is intact on top of the GGUF model");
  const gl = Object.values(wf).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v)));
  ok(gl.every(([id]) => id in wf) && nodes(wf, "VAELoader")[0].inputs.vae_name === "qwen_image_vae.safetensors", "…every link still points at a node, and the VAE is as before");
  ok(editFilesText(q, false) === qGguf, "the job log keeps the .gguf file");

  // Only the parts that use a .gguf file are switched.
  q = choose(byId(g, "qwen-image-edit"), { model: qGguf });
  wf = buildEdit(q, { ...params, textEncoderDevice: "cpu" });
  ok(nodes(wf, "UnetLoaderGGUF").length === 1 && nodes(wf, "CLIPLoader")[0].inputs.clip_name === "qwen_2.5_vl_7b_fp8_scaled.safetensors", "a GGUF model with a safetensors text encoder switches only the model's loader");
  ok(wf["2"].inputs.device === "cpu" && q.devices.join() === "default,cpu", "…and the text encoder's device is set to cpu where the loader offers it");
  wf = buildEdit(q, params);
  ok(wf["2"].inputs.device === "default", "…and default otherwise");
  const noDevice = { ...ggufInfo({ unet: [qGguf], clip: normal.clip, vae: normal.vae }), CLIPLoader: { input: { required: { clip_name: [normal.clip, {}], type: [["qwen_image"], {}] } } } as NodeInfo };
  q = choose(byId(checkEditModels(noDevice), "qwen-image-edit"), {});
  ok(!("device" in buildEdit(q, { ...params, textEncoderDevice: "cpu" })["2"].inputs) && q.devices.length === 0, "a loader with no device input gets none");
  const gpuOnly = { ...noDevice, CLIPLoader: { input: { required: { clip_name: [normal.clip, {}], type: [["qwen_image"], {}] }, optional: { device: [["default"], {}] } } } as NodeInfo };
  q = choose(byId(checkEditModels(gpuOnly), "qwen-image-edit"), {});
  ok(!("device" in buildEdit(q, { ...params, textEncoderDevice: "cpu" })["2"].inputs), "…and a value the loader doesn't offer is dropped");
  q = choose(byId(checkEditModels(ggufInfo({ unet: [qGguf], clip: [vlGguf], vae: normal.vae }, true, true)), "qwen-image-edit"), { textEncoder: vlGguf });
  ok(buildEdit(q, { ...params, textEncoderDevice: "cpu" })["2"].inputs.device === "cpu", "a GGUF text encoder loader that lists a device gets it");
  ok(!("device" in buildEdit(choose(byId(checkEditModels(info(all)), "qwen-image-edit"), {}), { ...params, textEncoderDevice: "cpu" })["2"].inputs), "…an ordinary check where the loader lists no device input leaves it out too");

  // A .gguf file needs the GGUF loader to be there.
  const lonely = byId(checkEditModels(ggufInfo({ unet: [qGguf], clip: normal.clip, vae: normal.vae })), "qwen-image-edit");
  const withoutNode = { ...lonely, loaders: Object.fromEntries(Object.entries(lonely.loaders).filter(([k]) => k !== "UnetLoaderGGUF")) };
  ok(choose(lonely, { model: qGguf }).ready && !choose(withoutNode, { model: qGguf }).ready, "a .gguf file in use needs its GGUF loader node for the preset to be ready");
  const mixed = byId(checkEditModels(ggufInfo({ unet: [qGguf, all.unet[0]], clip: normal.clip, vae: normal.vae })), "qwen-image-edit");
  ok(choose({ ...mixed, loaders: {} }, {}).ready, "…which a safetensors model never does");

  // Kontext: a GGUF model, and a GGUF T5 through the dual loader (which then loads CLIP-L too).
  const kinfo = ggufInfo({ unet: [kGguf], clip: ["clip_l.safetensors", t5Gguf], vae: normal.vae });
  let k = choose(byId(checkEditModels(kinfo), "flux-kontext"), { model: kGguf, t5: t5Gguf });
  ok(k.ready && k.files.clipL === "clip_l.safetensors", "Kontext: a safetensors CLIP-L with a GGUF T5 is ready");
  wf = buildEdit(k, { ...params, loras: [{ name: "styles/ink.safetensors", strength: 1 }], textEncoderDevice: "cpu" });
  const dual = nodes(wf, "DualCLIPLoaderGGUF")[0];
  ok(nodes(wf, "DualCLIPLoader").length === 0 && dual.inputs.clip_name1 === "clip_l.safetensors" && dual.inputs.clip_name2 === t5Gguf && dual.inputs.type === "flux", "…its text encoders go through one DualCLIPLoaderGGUF, with both files");
  ok(!("device" in dual.inputs) && k.devices.length === 0, "…which lists no device here, so none is sent");
  ok(nodes(wf, "UnetLoaderGGUF")[0].inputs.unet_name === kGguf && chainOf(wf).from === "UnetLoaderGGUF" && chainOf(wf).loras.length === 1, "…the model by UnetLoaderGGUF with the LoRA after it");
  k = choose(byId(checkEditModels(kinfo), "flux-kontext"), { model: kGguf });
  wf = buildEdit(k, { ...params, textEncoderDevice: "cpu" });
  ok(k.files.t5 === t5Gguf && nodes(wf, "DualCLIPLoaderGGUF").length === 1, "a T5 found by name that is GGUF switches the dual loader too");
  k = choose(byId(checkEditModels(info(all)), "flux-kontext"), {});
  ok(k.ready && nodes(buildEdit(k, params), "DualCLIPLoader").length === 1 && k.devices.length === 0, "with only safetensors files, Kontext's workflow is as before");

  // With an all-in-one checkpoint, a GGUF text encoder of the preset's own still works.
  const ck = choose(byId(checkEditModels(ggufInfo({ unet: [], clip: [vlGguf], vae: normal.vae, ...{} })), "qwen-image-edit"), { textEncoder: vlGguf }, "x.safetensors");
  ok(!ck.ready && ck.checkpoint?.found === false, "an unlisted checkpoint still stops the preset, GGUF or not");
}

// ---- exporting a preset's workflow for ComfyUI ----
{
  const { drawPresetWorkflow, editPresetWorkflow, SAMPLE_IMAGE } = await import("../../src/lib/comfy/exportWorkflow.ts");
  const { newDrawPreset, newEditPreset } = await import("../../src/lib/comfy/presets.ts");
  const dp = { ...newDrawPreset("d", "D", "my.safetensors"), loras: [{ name: "l.safetensors", strength: 0.5, on: true }, { name: "off.safetensors", strength: 1, on: false }] };
  const dw = drawPresetWorkflow(dp, null, { width: 832, height: 1216 })!;
  const dn = Object.values(dw);
  ok(dn.some((n) => n.class_type === "CheckpointLoaderSimple" && n.inputs.ckpt_name === "my.safetensors") && dn.filter((n) => n.class_type === "LoraLoader").length === 1, "a checkpoint preset exports its checkpoint and its LoRAs that are on");
  ok(dn.some((n) => n.class_type === "EmptyLatentImage" && n.inputs.width === 832 && n.inputs.height === 1216) && dn.every((n) => !JSON.stringify(n.inputs).includes("{{")), "…at the Settings size, with no placeholders left");
  ok(drawPresetWorkflow({ ...dp, family: "zimage" }, null, { width: 1, height: 1 }) === null, "a model-family preset without a ready check has nothing to export");
  const qc = byId(checkEditModels(info(all)), "qwen-image-edit");
  const ew = editPresetWorkflow(newEditPreset("e", "E", "qwen-image-edit"), qc)!;
  ok(Object.values(ew).some((n) => n.class_type === "LoadImage" && n.inputs.image === SAMPLE_IMAGE) && Object.values(ew).some((n) => n.class_type === "TextEncodeQwenImageEditPlus" && String(n.inputs.prompt).length > 0), "an edit preset exports its workflow with a sample picture and instruction");
  ok(editPresetWorkflow(newEditPreset("e", "E", "qwen-image-edit"), byId(checkEditModels(info({})), "qwen-image-edit")) === null, "…and nothing when the model isn't ready");
}
