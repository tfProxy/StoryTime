// Reference pictures in the drawing workflows (IP-Adapter in front of the sampler's model), the Reference type
// and what the job log keeps of them. Pure logic, no server.
import { ipAdapterProblem, withReferences, checkIpAdapter } from "../../src/lib/comfy/ipAdapter.ts";
import { asReference, DEFAULT_WEIGHTS, referenceText, storedOf } from "../../src/lib/comfy/references.ts";
import { readTag } from "../../src/lib/comfy/jobTag.ts";
import { BUILTIN_WORKFLOW, describeWorkflow, fillWorkflow, parseWorkflow, WorkflowError, type PictureParams, type Workflow } from "../../src/lib/comfy/workflow.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const nodes = (wf: Workflow, type: string) => Object.entries(wf).filter(([, n]) => n.class_type === type);
const message = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof Error ? e.message : String(e); }
  return null;
};

const files = { ipadapter: "ip-adapter-plus_sdxl_vit-h.safetensors", clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" };
const refs = [
  { image: "storytime-ref-a.png", role: "character" as const, weight: 0.7 },
  { image: "storytime-ref-b.png", role: "style" as const, weight: 0.8 },
];
const params: PictureParams = { prompt: "a lighthouse", negative: "text", checkpoint: "sdxl.safetensors", width: 832, height: 1216, count: 1, seed: 7 };

// ---- the Reference type ----
ok(DEFAULT_WEIGHTS.character === 0.7 && DEFAULT_WEIGHTS.item === 0.6 && DEFAULT_WEIGHTS.place === 0.5 && DEFAULT_WEIGHTS.style === 0.8, "default weights per role");
const start = { key: "comfy:a/b.png", thumb: "http://x/view", source: "comfy:a/b.png", blob: async () => new Blob(["x"]) };
const jim = asReference(start, "Jim", "character");
ok(jim.weight === 0.7 && jim.key === start.key && jim.source === start.source && jim.thumb === start.thumb, "a picture becomes a reference with its role's default weight");
ok(asReference(start, "Tavern", "place", 0.4).weight === 0.4, "…or the weight given");
const stored = storedOf([jim, asReference(start, "Tavern", "place")]);
ok(JSON.stringify(stored[0]) === JSON.stringify({ source: "comfy:a/b.png", label: "Jim", role: "character", weight: 0.7 }) && !("blob" in stored[0]), "only the serialisable part is recorded");
ok(stored.map(referenceText).join(", ") === "Jim (character 0.7), Tavern (place 0.5)", "a reference reads “Jim (character 0.7)”");
ok(storedOf(undefined).length === 0, "no references is an empty list");

// ---- withReferences ----
const plain = withReferences(BUILTIN_WORKFLOW, refs, files);
ok(plain !== BUILTIN_WORKFLOW && !("ref-loader" in BUILTIN_WORKFLOW), "the workflow given is not changed");
ok(nodes(plain, "IPAdapterModelLoader").length === 1 && nodes(plain, "IPAdapterModelLoader")[0][1].inputs.ipadapter_file === files.ipadapter, "one adapter loader with the file");
ok(nodes(plain, "CLIPVisionLoader").length === 1 && nodes(plain, "CLIPVisionLoader")[0][1].inputs.clip_name === files.clipVision, "one CLIP Vision loader with the file");
ok(nodes(plain, "LoadImage").length === 2 && nodes(plain, "IPAdapterAdvanced").length === 2, "a LoadImage and an IPAdapterAdvanced per reference");
const [first, second] = nodes(plain, "IPAdapterAdvanced").map(([, n]) => n.inputs);
ok(JSON.stringify(first.model) === '["4",0]' && JSON.stringify(second.model) === '["ref-1",0]', "the adapters are chained, the first after the checkpoint's model");
ok(JSON.stringify(plain["3"].inputs.model) === '["ref-2",0]', "the sampler takes the end of the chain");
ok(first.weight === 0.7 && first.weight_type === "linear" && first.end_at === 0.8 && first.start_at === 0 && first.combine_embeds === "concat" && first.embeds_scaling === "V only", "a character: linear, up to 0.8, concat, V only");
ok(second.weight === 0.8 && second.weight_type === "style transfer" && second.end_at === 1, "a style: style transfer, to the end");
ok(JSON.stringify(first.ipadapter) === '["ref-loader",0]' && JSON.stringify(first.clip_vision) === '["ref-clip-vision",0]' && JSON.stringify(first.image) === '["ref-1-image",0]', "each adapter is linked to the loaders and its image");
ok(JSON.stringify(plain["ref-1-image"].inputs) === '{"image":"storytime-ref-a.png"}', "the image is the uploaded name");
ok(withReferences(BUILTIN_WORKFLOW, [], files)["3"].inputs.model !== undefined && Object.keys(withReferences(BUILTIN_WORKFLOW, [], files)).length === Object.keys(BUILTIN_WORKFLOW).length, "no references changes nothing");
ok(/nowhere to put/.test(message(() => withReferences({ "1": { class_type: "SaveImage", inputs: {} } }, refs, files)) ?? ""), "a workflow with no sampler model says so");

// ---- fillWorkflow ----
const paramsWith = { ...params, refs, ipAdapter: files };
for (const [name, extra] of [["text to image", {}], ["image to image", { image: "start.png", denoise: 0.6 }], ["inpaint", { image: "start.png", denoise: 0.6, mask: "m.png" }]] as const) {
  const out = fillWorkflow(BUILTIN_WORKFLOW, { ...paramsWith, ...extra });
  const sampler = nodes(out, "KSampler")[0][1].inputs;
  ok(nodes(out, "IPAdapterAdvanced").length === 2 && JSON.stringify(sampler.model) === '["ref-2",0]', `the built-in ${name} workflow takes the references`);
  ok(!JSON.stringify(out).includes("{{"), `…and has no placeholders left (${name})`);
}
const withLora = fillWorkflow(BUILTIN_WORKFLOW, { ...paramsWith, loras: [{ name: "style.safetensors", strength: 0.8 }] });
ok(JSON.stringify(nodes(withLora, "IPAdapterAdvanced")[0][1].inputs.model) === '["storytime_lora_1",0]', "references wrap the model after the LoRAs");
ok(nodes(fillWorkflow(BUILTIN_WORKFLOW, params), "IPAdapterAdvanced").length === 0, "without references the workflow is as before");

const pasted = parseWorkflow(JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "a.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "x", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "y", clip: ["1", 1] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
  "5": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { filename_prefix: "StoryTime", images: ["6", 0] } },
}));
ok(describeWorkflow(pasted).refs && describeWorkflow(BUILTIN_WORKFLOW).refs, "the built-in and a placeholder-less pasted workflow can take references");
const filled = fillWorkflow(pasted, paramsWith);
ok(JSON.stringify(filled["5"].inputs.model) === '["ref-2",0]' && JSON.stringify(nodes(filled, "IPAdapterAdvanced")[0][1].inputs.model) === '["1",0]', "a pasted workflow's sampler is found and wrapped");
const fromPicture = fillWorkflow(pasted, { ...paramsWith, image: "start.png", denoise: 0.5 });
ok(JSON.stringify(fromPicture["5"].inputs.model) === '["ref-2",0]' && "storytime_image" in fromPicture, "…also when it starts from a picture");

const placeholders = parseWorkflow(JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{checkpoint}}" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["1", 1] } },
  "5": { class_type: "KSampler", inputs: { seed: "{{seed}}", model: ["1", 0], positive: ["2", 0], negative: ["2", 0], latent_image: ["4", 0] } },
}));
ok(!describeWorkflow(placeholders).refs, "a placeholder workflow says it can't take references");
const err = (() => { try { fillWorkflow(placeholders, paramsWith); } catch (e) { return e; } return null; })();
ok(err instanceof WorkflowError && /can't take reference pictures/.test(err.message), "…and filling it with references throws a clear error");
ok(/IP-Adapter and CLIP Vision files/.test(message(() => fillWorkflow(BUILTIN_WORKFLOW, { ...params, refs })) ?? ""), "references without the adapter's files are refused");

// ---- ipAdapterProblem ----
const nodeInfo = (adapter: string[], vision: string[], absent: string[] = []) => ({
  IPAdapterModelLoader: { input: { required: { ipadapter_file: [adapter, {}] } } },
  IPAdapterAdvanced: { input: { required: {} } },
  CLIPVisionLoader: { input: { required: { clip_name: ["COMBO", { options: vision }] } } },
  ...Object.fromEntries(absent.map((n) => [n, null])),
});
ok(ipAdapterProblem(checkIpAdapter(nodeInfo([files.ipadapter], [files.clipVision]), "sdxl")) === null, "no problem when IP-Adapter is ready");
ok(/CLIP Vision model/.test(ipAdapterProblem(checkIpAdapter(nodeInfo([files.ipadapter], []), "sdxl")) ?? "") && /CLIP-ViT-H-14/.test(ipAdapterProblem(checkIpAdapter(nodeInfo([files.ipadapter], []), "sdxl")) ?? ""), "a missing file is named");
ok(/IPAdapterAdvanced/.test(ipAdapterProblem(checkIpAdapter(nodeInfo([files.ipadapter], [files.clipVision], ["IPAdapterAdvanced"]), "sdxl")) ?? ""), "a missing node is named");
ok(ipAdapterProblem(null) !== null, "not knowing yet is a problem too");

// ---- the job tag ----
const job = { prompt: "a lamp", negative: "", checkpoint: "a.safetensors", width: 1024, height: 1024, seed: 5, count: 2, moment: "start" };
const tag = { chapterId: "c1", storyId: "s1", clientId: "storytime-x", job: { ...job, refs: stored } };
ok(readTag({ storytime: tag })?.job.refs?.length === 2, "a tag with references is read back");
ok(readTag({ storytime: { ...tag, job: { ...job, refs: [{ source: "x", label: "a", role: "monster", weight: 1 }] } } }) === null, "an unknown role is refused");
ok(readTag({ storytime: { ...tag, job: { ...job, refs: [1, 2, 3, 4, 5] } } }) === null, "bad references are refused");
