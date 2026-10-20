// Settings are stored on the server, so every session sees the same ones.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("GET", "/api/settings");
ok(r.status === 200 && r.json.settings === null, "no settings until some are saved");

const conns = { connections: [{ id: "o", name: "Ollama", kind: "ollama", baseUrl: "http://x/v1", apiKey: "k" }], defaults: { main: { connectionId: "o", model: "m" }, cheap: null }, contextTokens: 4000 };
r = await call("PUT", "/api/settings", conns);
ok(r.status === 200 && r.json.settings.connections[0].kind === "ollama", "settings can be saved");

r = await call("GET", "/api/settings");
ok(r.json.settings.contextTokens === 4000 && r.json.settings.connections[0].apiKey === "k" && r.json.settings.defaults.main.model === "m", "a later request gets them back");
ok(Array.isArray(r.json.settings.favorites) && r.json.settings.temperature === null, "missing parts are filled with defaults");
ok(r.json.settings.autoSuggestChoices === false, "suggesting choices after writing is off unless asked for");
r = await call("PUT", "/api/settings", { ...conns, autoSuggestChoices: true });
ok(r.json.settings.autoSuggestChoices === true && (await call("GET", "/api/settings")).json.settings.autoSuggestChoices === true, "…and can be turned on");

ok(r.json.settings.imagePromptStyle === "tags" && (await call("GET", "/api/settings")).json.settings.imagePromptStyle === "tags", "picture prompts are written as tags unless asked otherwise");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: "natural" });
ok(r.json.settings.imagePromptStyle === "natural" && (await call("GET", "/api/settings")).json.settings.imagePromptStyle === "natural", "…and the sentence style is kept");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: "poetry" });
ok(r.status === 200 && r.json.settings.imagePromptStyle === "tags", "an unknown picture prompt style falls back to tags");
r = await call("PUT", "/api/settings", { ...conns, imagePromptStyle: 7 });
ok(r.json.settings.imagePromptStyle === "tags", "…as does a value that isn't text");

// ---- ComfyUI (picture making) ----
const comfyDefaults = { url: "", workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 };
r = await call("PUT", "/api/settings", conns);
ok(JSON.stringify(r.json.settings.comfy) === JSON.stringify(comfyDefaults), "ComfyUI settings default to no address, the built-in workflow, 1344 x 768 and 4 pictures");
const comfyIn = { url: "http://comfy.local:8188", workflow: '{"1":{"class_type":"X","inputs":{}}}', checkpoint: "sdxl.safetensors", width: 1024, height: 1024, count: 2 };
r = await call("PUT", "/api/settings", { ...conns, comfy: comfyIn });
ok(JSON.stringify(r.json.settings.comfy) === JSON.stringify(comfyIn) && JSON.stringify((await call("GET", "/api/settings")).json.settings.comfy) === JSON.stringify(comfyIn), "ComfyUI settings are saved and read back");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 20, width: 10, height: 99999 } });
ok(r.json.settings.comfy.count === 4 && r.json.settings.comfy.width === 1344 && r.json.settings.comfy.height === 768 && r.json.settings.comfy.url === comfyIn.url, "a count or size out of range falls back on its own, keeping the other fields");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 0 } });
ok(r.json.settings.comfy.count === 4, "a count of 0 falls back to 4");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 2.5, width: "wide", url: 5, checkpoint: null } });
ok(r.json.settings.comfy.count === 4 && r.json.settings.comfy.width === 1344 && r.json.settings.comfy.url === "" && r.json.settings.comfy.checkpoint === "" && r.json.settings.comfy.height === 1024, "fractions, text where a number belongs and numbers where text belongs each fall back on their own");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, count: 8, width: 64, height: 4096 } });
ok(r.json.settings.comfy.count === 8 && r.json.settings.comfy.width === 64 && r.json.settings.comfy.height === 4096, "the limits themselves (8 pictures, 64 and 4096 pixels) are allowed");
r = await call("PUT", "/api/settings", { ...conns, comfy: "yes" });
ok(JSON.stringify(r.json.settings.comfy) === JSON.stringify(comfyDefaults), "a ComfyUI setting that isn't an object falls back to the defaults");
r = await call("PUT", "/api/settings", { ...conns, comfy: { ...comfyIn, workflow: "x".repeat(500_001) } });
ok(r.json.settings.comfy.workflow === "" && r.json.settings.comfy.url === comfyIn.url, "a workflow over 500,000 characters is dropped");

r = await call("PUT", "/api/settings", { connections: "bogus", defaults: { main: { connectionId: "nope", model: "m" } }, contextTokens: 5 });
ok(r.status === 200 && r.json.settings.connections.length === 0 && r.json.settings.defaults.main === null && r.json.settings.contextTokens === 8000, "invalid fields fall back to defaults");

ok((await call("PUT", "/api/settings", [])).status === 400, "a non-object body is rejected");
