import { checkEditModels, comboOptions, EDIT_MODELS, EDIT_NODES, editModel, editSize, type NodeInfo } from "../../src/lib/comfy/editModels.ts";
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
function info(files: { unet?: string[]; clip?: string[]; vae?: string[] }, missing: string[] = [], clipTypes = ["qwen_image"], dualTypes = ["flux"]): Record<string, NodeInfo> {
  const loaders: Record<string, Record<string, unknown>> = {
    UNETLoader: { unet_name: [files.unet ?? [], {}] },
    CLIPLoader: { clip_name: [files.clip ?? [], {}], type: [clipTypes, {}] },
    DualCLIPLoader: { clip_name1: ["COMBO", { options: files.clip ?? [] }], clip_name2: ["COMBO", { options: files.clip ?? [] }], type: ["COMBO", { options: dualTypes }] },
    VAELoader: { vae_name: [files.vae ?? [], {}] },
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
