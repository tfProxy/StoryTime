// IP-Adapter for reference pictures: the model base guessed from a checkpoint's name, the files each base
// needs, and the check against what ComfyUI's /object_info lists. Pure logic, no server.
import { baseOf, checkIpAdapter, guessBase, IPADAPTER_NODES, IPADAPTER_PARTS } from "../../src/lib/comfy/ipAdapter.ts";
import { findFile, type NodeInfo } from "../../src/lib/comfy/modelParts.ts";
import { newDrawPreset } from "../../src/lib/comfy/presets.ts";
import { parseSettings } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

ok(guessBase("novaFurryXL_ilV180A.safetensors") === "illustrious" && guessBase("model_il_v2.safetensors") === "illustrious" && guessBase("civil.safetensors") === "sdxl", "Illustrious from an 'il' in the name, such as _ilV180, but not inside a word");
ok(guessBase("noobaiXL_vpred10.safetensors") === "noobai" && guessBase("furry/NoobAI-v1.safetensors") === "noobai", "NoobAI checkpoints are guessed from 'noob'");
ok(guessBase("illustriousXL_v10.safetensors") === "illustrious" && guessBase("waiIllu.safetensors") === "illustrious" && guessBase("cool_ilxl.safetensors") === "illustrious", "Illustrious from 'illustrious', 'illu' and 'ilxl'");
ok(guessBase("ponyDiffusionV6XL.safetensors") === "pony" && guessBase("autismPDXL.safetensors") === "pony", "Pony from 'pony' and 'pdxl'");
ok(guessBase("juggernautXL.safetensors") === "sdxl" && guessBase("") === "sdxl" && guessBase("illuminated.safetensors") === "sdxl", "anything else is SDXL ('illuminated' is not 'illu')");
ok(guessBase("noob_illustrious_merge.safetensors") === "noobai", "NoobAI wins over Illustrious");

ok(baseOf({ checkpoint: "ponyX.safetensors" }) === "pony" && baseOf({ base: "sdxl", checkpoint: "ponyX.safetensors" }) === "sdxl", "a chosen base beats the guess");

const info = (adapter: string[], vision: string[], o: { missing?: string[] } = {}): Record<string, NodeInfo> => ({
  IPAdapterModelLoader: { input: { required: { ipadapter_file: [adapter, {}] } } },
  IPAdapterAdvanced: { input: { required: {} } },
  CLIPVisionLoader: { input: { required: { clip_name: ["COMBO", { options: vision }] } } },
  ...Object.fromEntries((o.missing ?? []).map((n) => [n, null])),
});

const sdxlA = "ip-adapter-plus_sdxl_vit-h.safetensors";
const sdxlC = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors";
const noobA = "noobIPAMARK1_mark1.safetensors";
const noobC = "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors";

ok(IPADAPTER_PARTS.sdxl[0].recommended === sdxlA && IPADAPTER_PARTS.pony[1].recommended === sdxlC && IPADAPTER_PARTS.noobai[0].recommended === noobA && IPADAPTER_PARTS.illustrious[1].recommended === noobC, "each base recommends its files");
ok(IPADAPTER_PARTS.sdxl.every((p) => (p.key === "ipAdapter" ? p.folder === "ipadapter" && p.loader === "IPAdapterModelLoader" && p.input === "ipadapter_file" : p.folder === "clip_vision" && p.loader === "CLIPVisionLoader" && p.input === "clip_name")), "folders, loaders and inputs");

ok(findFile(IPADAPTER_PARTS.sdxl[0], ["sub/IP_Adapter-Plus-SDXL-ViT-H.safetensors", "ip-adapter_sdxl.safetensors"]) === "sub/IP_Adapter-Plus-SDXL-ViT-H.safetensors", "the SDXL adapter is found by a looser name, and the plain sdxl one does not match");
ok(findFile(IPADAPTER_PARTS.noobai[0], ["NoobIPA_v2.safetensors"]) === "NoobIPA_v2.safetensors" && findFile(IPADAPTER_PARTS.noobai[1], ["clip_vit_bigg_14.safetensors"]) === "clip_vit_bigg_14.safetensors", "NoobAI's files are found by name");
ok(findFile(IPADAPTER_PARTS.sdxl[1], [noobC]) === null && findFile(IPADAPTER_PARTS.noobai[1], [sdxlC]) === null, "one base's CLIP Vision file is not the other's");

let c = checkIpAdapter(info([sdxlA], [sdxlC]), "sdxl");
ok(c.ready && c.missingNodes.length === 0 && c.files.ipAdapter === sdxlA && c.files.clipVision === sdxlC, "SDXL with both files is ready");
c = checkIpAdapter(info([sdxlA], [sdxlC]), "noobai");
ok(!c.ready && c.parts.every((p) => p.file === null) && Object.keys(c.files).length === 0, "NoobAI needs its own files");
c = checkIpAdapter(info([noobA], [noobC]), "illustrious");
ok(c.ready && c.base === "illustrious" && c.files.ipAdapter === noobA, "Illustrious uses NoobAI's files");
c = checkIpAdapter(info([sdxlA], []), "pony");
ok(!c.ready && c.parts[0].file === sdxlA && c.parts[1].file === null, "a missing CLIP Vision file is not ready");
c = checkIpAdapter(info([sdxlA], [sdxlC], { missing: ["IPAdapterModelLoader", "IPAdapterAdvanced"] }), "sdxl");
ok(!c.ready && c.missingNodes.join() === "IPAdapterModelLoader,IPAdapterAdvanced", "missing nodes are listed");
c = checkIpAdapter(Object.fromEntries(IPADAPTER_NODES.map((n) => [n, null])), "sdxl");
ok(!c.ready && c.missingNodes.length === 3 && c.parts.every((p) => p.file === null), "ComfyUI without any of it: not ready, nothing breaks");
c = checkIpAdapter(info(["other.safetensors", sdxlA], [sdxlC]), "sdxl", { ipAdapter: "other.safetensors" });
ok(c.ready && c.files.ipAdapter === "other.safetensors", "a chosen file is used");
c = checkIpAdapter(info([sdxlA], [sdxlC]), "sdxl", { ipAdapter: "gone.safetensors" });
ok(!c.ready && c.parts[0].chosen === "gone.safetensors", "a chosen file ComfyUI doesn't list is missing");

// Settings: base is optional, and old settings parse.
const parsed = (preset: Record<string, unknown>) => parseSettings({ comfy: { drawPresets: [{ id: "a", name: "A", ...preset }] } }).comfy.drawPresets[0];
ok(parsed({ checkpoint: "x.safetensors" }).base === undefined && !("base" in newDrawPreset("a", "A")), "a preset with no base has none");
ok(parsed({ base: "noobai" }).base === "noobai" && parsed({ base: "pony" }).base === "pony", "a base is kept");
ok(parsed({ base: "flux" }).base === undefined, "an unknown base is dropped, not an error");
