// Settings are stored on the server, so every session sees the same ones.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("GET", "/api/settings");
ok(r.status === 200 && r.json.settings === null, "no settings until some are saved");

// ---- settings from before picture presets ----
// Stories chose a checkpoint then; the first save turns each one stories used into a drawing preset.
// (Stories from the other test files may have checkpoints too, so only these stories are checked.)
const story = async (title, checkpoint) => {
  const id = (await call("POST", "/api/stories", { title, chapter: { title: "Root", body: "b" } })).json.story_id;
  if (checkpoint) await call("PATCH", `/api/stories/${id}`, { checkpoint });
  return id;
};
const mine = {
  common1: await story("Preset 1", "zz-common.safetensors"),
  common2: await story("Preset 2", "zz-common.safetensors"),
  common3: await story("Preset 3", "zz-common.safetensors"),
  rare: await story("Preset 4", "styles/zz-rare.safetensors"),
  none: await story("Preset 5", ""),
};
const ink = { name: "styles/ink.safetensors", strength: 0.8, on: true };
const hero = { name: "hero.safetensors", strength: -0.5, on: false };
const legacy = {
  url: "http://comfy.local:8188", workflow: '{"1":{"class_type":"X","inputs":{}}}', checkpoint: "unused.safetensors", width: 1024, height: 1024, count: 2,
  denoise: 0.3, editModel: "flux-kontext", editFast: false, editLoras: { "qwen-image-edit": [ink, hero] }, redraw: { steps: 25, sampler: "euler_ancestral" },
  editTuning: { "qwen-image-edit": { steps: 30, cfg: 3, strength: 0.8, shift: 2.5 }, "flux-kontext": { scheduler: "beta", guidance: 3.5 } },
};
const conns = { connections: [{ id: "o", name: "Ollama", kind: "ollama", baseUrl: "http://x/v1", apiKey: "k" }], defaults: { main: { connectionId: "o", model: "m" }, cheap: null }, contextTokens: 4000 };
r = await call("PUT", "/api/settings", { ...conns, comfy: legacy });
ok(r.status === 200 && r.json.settings.connections[0].kind === "ollama", "settings can be saved");
const up = r.json.settings.comfy;
ok(up.url === legacy.url && up.width === 1024 && up.count === 2 && !("workflow" in up) && !("editLoras" in up), "the old picture settings become presets; the address and size stay");
const byCheckpoint = (c) => up.drawPresets.find((p) => p.checkpoint === c);
const common = byCheckpoint("zz-common.safetensors");
const rare = byCheckpoint("styles/zz-rare.safetensors");
ok(common && rare && !byCheckpoint("unused.safetensors"), "each checkpoint stories used becomes a drawing preset (the old shared checkpoint wasn't used, so it doesn't)");
ok(rare.name === "zz-rare" && new Set(up.drawPresets.map((p) => p.id)).size === up.drawPresets.length, "…named after the checkpoint file, each with its own id");
ok(
  up.drawPresets.every((p) => p.workflow === legacy.workflow && p.denoise === 0.3 && JSON.stringify(p.sampler) === JSON.stringify(legacy.redraw) && p.loras.length === 0),
  "…each with the old workflow, Redraw strength and sampler settings, and no LoRAs",
);
const uses = async (id) => {
  const s = (await call("GET", `/api/stories/${id}`)).json;
  return up.drawPresets.find((p) => p.id === s.draw_preset) ?? up.drawPresets[0];
};
ok((await uses(mine.common1)).checkpoint === "zz-common.safetensors" && (await uses(mine.common3)).checkpoint === "zz-common.safetensors", "each story uses the preset with its checkpoint");
ok((await uses(mine.rare)).checkpoint === "styles/zz-rare.safetensors", "…a story with a less used checkpoint too");
ok((await call("GET", `/api/stories/${mine.none}`)).json.draw_preset === null, "a story that had none follows the top preset");
const qwen = up.editPresets.find((p) => p.model === "qwen-image-edit");
const kontext = up.editPresets.find((p) => p.model === "flux-kontext");
ok(up.editPresets.length === 2 && qwen.id === "qwen-image-edit" && kontext.id === "flux-kontext" && qwen.name === "Default", "each edit model gets a Default preset, whose id is the model's");
ok(JSON.stringify(qwen.loras) === JSON.stringify([ink, hero]) && kontext.loras.length === 0 && qwen.fast === false && kontext.fast === false, "…with its old LoRA stack and the old Fast box");
ok(JSON.stringify(qwen.tuning) === JSON.stringify(legacy.editTuning["qwen-image-edit"]) && kontext.tuning.guidance === 3.5, "…and its old settings");
ok(up.editPreset === "flux-kontext", "the edit model last used becomes the edit preset last used");
r = await call("PUT", "/api/settings", conns);
ok(JSON.stringify(r.json.settings.comfy.drawPresets) === JSON.stringify(up.drawPresets) && r.json.settings.comfy.editPresets.length === 2, "settings saved without presets afterwards (a page with the old code) keep the presets");

r = await call("GET", "/api/settings");
ok(r.json.settings.contextTokens === 4000 && r.json.settings.connections[0].apiKey === "k" && r.json.settings.defaults.main.model === "m", "a later request gets them back");
ok(Array.isArray(r.json.settings.favorites) && r.json.settings.temperature === null, "missing parts are filled with defaults");
ok(r.json.settings.autoSuggestChoices === false, "suggesting choices after writing is off unless asked for");
r = await call("PUT", "/api/settings", { ...conns, autoSuggestChoices: true });
ok(r.json.settings.autoSuggestChoices === true && (await call("GET", "/api/settings")).json.settings.autoSuggestChoices === true, "…and can be turned on");

// ---- the outline's parts ----
const allOutline = { summary: true, readToHere: true, headerPicture: true, footerPicture: true, illustrate: true };
ok(JSON.stringify((await call("GET", "/api/settings")).json.settings.outline) === JSON.stringify(allOutline), "every part of the outline is shown unless turned off");
r = await call("PUT", "/api/settings", { ...conns, outline: { ...allOutline, readToHere: false, illustrate: false } });
ok(JSON.stringify(r.json.settings.outline) === JSON.stringify({ ...allOutline, readToHere: false, illustrate: false }) && (await call("GET", "/api/settings")).json.settings.outline.readToHere === false, "parts turned off are kept");
r = await call("PUT", "/api/settings", { ...conns, outline: { summary: false } });
ok(JSON.stringify(r.json.settings.outline) === JSON.stringify({ ...allOutline, summary: false }), "a part not mentioned stays on");
r = await call("PUT", "/api/settings", { ...conns, outline: { summary: "no", headerPicture: 0, footerPicture: null } });
ok(JSON.stringify(r.json.settings.outline) === JSON.stringify(allOutline), "a part that isn't true or false is left on");
r = await call("PUT", "/api/settings", { ...conns, outline: "off" });
ok(JSON.stringify(r.json.settings.outline) === JSON.stringify(allOutline), "outline settings of the wrong kind are ignored");
r = await call("PUT", "/api/settings", { ...conns, outline: allOutline });

ok(r.json.settings.imagePromptStyle === "tags" && (await call("GET", "/api/settings")).json.settings.imagePromptStyle === "tags", "picture prompts are written as tags unless asked otherwise");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: "natural" });
ok(r.json.settings.imagePromptStyle === "natural" && (await call("GET", "/api/settings")).json.settings.imagePromptStyle === "natural", "…and the sentence style is kept");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: "poetry" });
ok(r.status === 200 && r.json.settings.imagePromptStyle === "tags", "an unknown picture prompt style falls back to tags");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: 7 });
ok(r.json.settings.imagePromptStyle === "tags", "…as does a value that isn't text");

ok(r.json.settings.imagePromptModel === null, "picture prompts use the default model unless one is chosen");
r = await call("PUT", "/api/settings", { ...conns, imagePromptModel: { connectionId: "o", model: "pics" } });
ok((await call("GET", "/api/settings")).json.settings.imagePromptModel?.model === "pics", "…and a chosen one is kept");
r = await call("PUT", "/api/settings", { ...conns, imagePromptModel: { connectionId: "gone", model: "pics" } });
ok(r.json.settings.imagePromptModel === null, "…but dropped when its connection doesn't exist");
r = await call("PUT", "/api/settings", { ...conns, imagePromptModel: "pics" });
ok(r.json.settings.imagePromptModel === null, "…or when it isn't a model");

// ---- ComfyUI (picture making), with presets ----
const draw = (id, extra = {}) => ({ id, name: `Drawing ${id}`, checkpoint: "sdxl.safetensors", workflow: "", loras: [], sampler: {}, denoise: 0.55, ...extra });
const edit = (id, model, extra = {}) => ({ id, name: `Edit ${id}`, model, checkpoint: "", files: {}, fast: true, loras: [], tuning: {}, ...extra });
const comfyIn = {
  url: "http://comfy.local:8188",
  width: 1024,
  height: 1024,
  coverWidth: 768,
  coverHeight: 1344,
  count: 2,
  drawPresets: [
    draw("ink", { workflow: '{"1":{"class_type":"X","inputs":{}}}', loras: [ink, hero], sampler: { steps: 25, sampler: "euler_ancestral" }, denoise: 0.3 }),
    draw("plain"),
  ],
  editPresets: [
    edit("qwen-a", "qwen-image-edit", { fast: false, loras: [ink], tuning: { steps: 30, cfg: 3, strength: 0.8, shift: 2.5 } }),
    edit("qwen-b", "qwen-image-edit", { checkpoint: "Qwen-Rapid-AIO-NSFW-v19.safetensors", files: { textEncoder: "qwen25vl-abliterated.safetensors" } }),
    edit("kontext-a", "flux-kontext", { tuning: { scheduler: "beta", guidance: 3.5 } }),
  ],
  editPreset: "kontext-a",
  picturesOldestFirst: false,
  queueCount: 1,
};
/** comfyIn with the first drawing preset (or the one at `i`) changed. */
const withDraw = (patch, i = 0) => ({ ...comfyIn, drawPresets: comfyIn.drawPresets.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
const withEdit = (patch, i = 0) => ({ ...comfyIn, editPresets: comfyIn.editPresets.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
r = await call("PUT", "/api/settings", { ...conns, comfy: comfyIn });
ok(JSON.stringify(r.json.settings.comfy) === JSON.stringify(comfyIn) && JSON.stringify((await call("GET", "/api/settings")).json.settings.comfy) === JSON.stringify(comfyIn), "ComfyUI settings and presets are saved and read back");
{
  const { coverWidth, coverHeight, ...noCover } = comfyIn;
  void coverWidth; void coverHeight;
  r = await call("PUT", "/api/settings", { ...conns, comfy: noCover });
  ok(r.json.settings.comfy.coverWidth === 832 && r.json.settings.comfy.coverHeight === 1216 && r.json.settings.comfy.width === 1024, "settings without a cover size get the book size, 832 × 1216, and keep the chapters' size");
}
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, picturesOldestFirst: true } });
ok(r.json.settings.comfy.picturesOldestFirst === true && (await call("GET", "/api/settings")).json.settings.comfy.picturesOldestFirst === true, "the Pictures panel's oldest-first order is kept");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, picturesOldestFirst: "yes" } });
ok(r.json.settings.comfy.picturesOldestFirst === false, "…and anything but true or false means newest first");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, queueCount: 5 } });
ok(r.json.settings.comfy.queueCount === 5, "the number of pictures one Queue click asks for is kept");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, queueCount: 3 } });
ok(r.json.settings.comfy.queueCount === 1, "…and a number that is not on the menu (1, 2, 4, 5, 8) means 1");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, drawPresets: [], editPresets: [] } });
let c = r.json.settings.comfy;
ok(
  c.drawPresets.length === 1 && c.drawPresets[0].id === "default" && c.drawPresets[0].checkpoint === "" && c.drawPresets[0].denoise === 0.55 &&
    JSON.stringify(c.editPresets.map((p) => [p.id, p.model, p.fast])) === JSON.stringify([["qwen-image-edit", "qwen-image-edit", true], ["flux-kontext", "flux-kontext", true]]),
  "with no presets there is still a Default drawing preset, and a Default for each edit model",
);
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, editPresets: [comfyIn.editPresets[0]] } });
c = r.json.settings.comfy;
ok(c.editPresets.length === 2 && c.editPresets[0].id === "qwen-a" && c.editPresets[1].model === "flux-kontext", "an edit model with no preset gets a Default one, keeping the others");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, editPresets: [edit("flux-kontext", "qwen-image-edit")] } });
c = r.json.settings.comfy;
ok(c.editPresets.length === 2 && c.editPresets[1].model === "flux-kontext" && c.editPresets[1].id === "flux-kontext-2", "…with an id of its own when its model's id is taken");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 20, width: 10, height: 99999 } });
ok(r.json.settings.comfy.count === 4 && r.json.settings.comfy.width === 1344 && r.json.settings.comfy.height === 768 && r.json.settings.comfy.url === comfyIn.url, "a count or size out of range falls back on its own, keeping the other fields");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 0 } });
ok(r.json.settings.comfy.count === 4, "a count of 0 falls back to 4");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 2.5, width: "wide", url: 5 } });
ok(r.json.settings.comfy.count === 4 && r.json.settings.comfy.width === 1344 && r.json.settings.comfy.url === "" && r.json.settings.comfy.height === 1024, "fractions, text where a number belongs and numbers where text belongs each fall back on their own");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 8, width: 64, height: 4096 } });
ok(r.json.settings.comfy.count === 8 && r.json.settings.comfy.width === 64 && r.json.settings.comfy.height === 4096, "the limits themselves (8 pictures, 64 and 4096 pixels) are allowed");
const firstDraw = (r) => r.json.settings.comfy.drawPresets[0];
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ denoise: 0.01 }) });
ok(firstDraw(r).denoise === 0.55 && firstDraw(r).loras.length === 2 && r.json.settings.comfy.count === 2, "a preset's strength below 0.05 falls back to 0.55, keeping the other fields");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ denoise: 1.5 }) });
ok(firstDraw(r).denoise === 0.55, "…as does one above 1");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ denoise: 1 }) });
ok(firstDraw(r).denoise === 1, "a strength of exactly 1 is allowed");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ name: 5, checkpoint: null, workflow: "x".repeat(500_001), denoise: "x" }) });
ok(firstDraw(r).name === "" && firstDraw(r).checkpoint === "" && firstDraw(r).workflow === "" && firstDraw(r).denoise === 0.55 && firstDraw(r).id === "ink", "a preset's bad name, checkpoint, workflow (over 500,000 characters) or strength falls back on its own");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, drawPresets: [draw("a"), { name: "no id" }, "x", draw(""), draw("a", { name: "again" })] } });
ok(JSON.stringify(r.json.settings.comfy.drawPresets.map((p) => p.name)) === '["Drawing a"]', "a preset without an id, or with one already used, is dropped");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, drawPresets: Array.from({ length: 45 }, (_, i) => draw(`p${i}`)) } });
ok(r.json.settings.comfy.drawPresets.length === 40, "at most 40 presets of a kind are kept");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ loras: [{ name: "a.safetensors", strength: 9 }, { name: 5 }, { name: "b.safetensors", strength: 0.5, on: "no" }, "x"] }) });
const stack = firstDraw(r).loras;
ok(stack.length === 2 && stack[0].strength === 1 && stack[0].on === true && stack[1].on === true && stack[1].strength === 0.5, "in a LoRA stack, a broken entry is dropped and a bad strength or on falls back on its own");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ loras: Array.from({ length: 12 }, (_, i) => ({ name: `l${i}.safetensors`, strength: 1, on: true })) }) });
ok(firstDraw(r).loras.length === 8, "a stack keeps at most 8 LoRAs");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ loras: { a: 1 } }) });
ok(firstDraw(r).loras.length === 0 && firstDraw(r).denoise === 0.3, "a stack that isn't a list falls back to none, keeping the other fields");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ sampler: { steps: 0, cfg: 99, sampler: "", scheduler: 5, extra: 1 } }) });
ok(JSON.stringify(firstDraw(r).sampler) === "{}", "out-of-range or wrong sampler values (and unknown keys) are dropped, so each falls back to its default");
r = await call("PUT", "/api/settings", { ...conns, comfy: withDraw({ sampler: { steps: 2.5, cfg: 7 } }) });
ok(JSON.stringify(firstDraw(r).sampler) === '{"cfg":7}', "…a fractional step count too, keeping the other changes");
r = await call("PUT", "/api/settings", { ...conns, comfy: withEdit({ fast: "yes", tuning: { strength: 0, shift: 3 } }) });
let qa = r.json.settings.comfy.editPresets[0];
ok(qa.fast === true && JSON.stringify(qa.tuning) === '{"shift":3}' && qa.loras.length === 1, "an edit preset's bad Fast or settings fall back on their own");
r = await call("PUT", "/api/settings", { ...conns, comfy: withEdit({ tuning: [1] }) });
ok(JSON.stringify(r.json.settings.comfy.editPresets[0].tuning) === "{}", "edit settings that aren't an object fall back to none");
r = await call("PUT", "/api/settings", { ...conns, comfy: withEdit({ checkpoint: 7, files: { model: "mine.safetensors", vae: 3, t5: "", spare: "x.safetensors", clipL: "y".repeat(501) } }) });
qa = r.json.settings.comfy.editPresets[0];
ok(qa.checkpoint === "" && JSON.stringify(qa.files) === '{"model":"mine.safetensors"}' && qa.loras.length === 1, "an edit preset's bad checkpoint falls back to none, and only named files of parts edit models have are kept");
r = await call("PUT", "/api/settings", { ...conns, comfy: withEdit({ files: ["a"] }) });
ok(JSON.stringify(r.json.settings.comfy.editPresets[0].files) === "{}", "files that aren't an object fall back to none");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, editPresets: [...comfyIn.editPresets, edit("x", "sdxl-edit")] } });
ok(r.json.settings.comfy.editPresets.length === 3, "an edit preset for a model StoryTime doesn't know is dropped");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, editPreset: undefined } });
ok(r.json.settings.comfy.editPreset === "qwen-image-edit", "with no edit preset last used, it is Qwen's first");
r = await call("PUT", "/api/settings", { ...conns, comfy: comfyIn });
r = await call("PUT", "/api/settings", { ...conns, comfy: "yes" });
c = r.json.settings.comfy;
ok(c.url === "" && c.width === 1344 && JSON.stringify(c.drawPresets) === JSON.stringify(comfyIn.drawPresets), "a ComfyUI setting that isn't an object falls back to the defaults, keeping the saved presets");

// ---- a story's drawing preset, and a chapter's own ----
r = await call("PATCH", `/api/stories/${mine.none}`, { draw_preset: "plain" });
ok(r.status === 200 && (await call("GET", `/api/stories/${mine.none}`)).json.draw_preset === "plain", "a story's drawing preset is saved");
r = await call("PATCH", `/api/stories/${mine.none}`, { title: "Renamed" });
ok((await call("GET", `/api/stories/${mine.none}`)).json.draw_preset === "plain", "…and kept when something else about the story changes");
r = await call("PATCH", `/api/stories/${mine.none}`, { draw_preset: null });
ok((await call("GET", `/api/stories/${mine.none}`)).json.draw_preset === null, "…and can be cleared, to follow the top preset");
ok((await call("PATCH", `/api/stories/${mine.none}`, { draw_preset: "" })).status === 400, "an empty preset id is rejected");
const chapter = (await call("GET", `/api/stories/${mine.none}`)).json.root_chapter_id;
ok((await call("GET", `/api/chapters/${chapter}/picture-preset`)).json.draw_preset === null, "a chapter uses its story's preset until it chooses one");
r = await call("PUT", `/api/chapters/${chapter}/picture-preset`, { draw_preset: "ink" });
ok(r.status === 200 && (await call("GET", `/api/chapters/${chapter}/picture-preset`)).json.draw_preset === "ink", "a chapter's own preset is saved");
r = await call("PUT", `/api/chapters/${chapter}/picture-preset`, { draw_preset: null });
ok(r.status === 200 && (await call("GET", `/api/chapters/${chapter}/picture-preset`)).json.draw_preset === null, "…and cleared");
ok((await call("PUT", `/api/chapters/${chapter}/picture-preset`, { draw_preset: 5 })).status === 400, "a preset id that isn't text is rejected");
ok((await call("PUT", "/api/chapters/nope/picture-preset", { draw_preset: "ink" })).status === 404, "a chapter that doesn't exist is a 404");

r = await call("PUT", "/api/settings", { connections: "bogus", defaults: { main: { connectionId: "nope", model: "m" } }, contextTokens: 5 });
ok(r.status === 200 && r.json.settings.connections.length === 0 && r.json.settings.defaults.main === null && r.json.settings.contextTokens === 8000, "invalid fields fall back to defaults");

ok((await call("PUT", "/api/settings", [])).status === 400, "a non-object body is rejected");
