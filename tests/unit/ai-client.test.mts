import http from "node:http";
import { streamChat, listModels, completeChat, AiError } from "../../src/lib/ai/client.ts";
import { freeOllamaForPictures, freeOllamaMemory, ollamaRoot } from "../../src/lib/ai/ollama.ts";
import { DEFAULT_SETTINGS, favoritesFor, parseSettings, exportSettingsJson, importSettingsJson } from "../../src/lib/settingsSchema.ts";

const seen: { url?: string; headers?: http.IncomingHttpHeaders; body?: any }[] = [];
const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body: data ? JSON.parse(data) : undefined });
    if (req.url?.endsWith("/models") || req.url?.includes("/models?")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: "b-model" }, { id: "a-model" }] }));
    }
    if (req.url === "/comfy/free") { res.setHeader("content-type", "application/json"); return res.end("{}"); }
    if (req.url === "/ol/api/ps") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ models: [{ name: "big:14b", model: "big:14b" }, { name: "tiny:1b" }] })); }
    if (req.url === "/ol/api/generate") { res.setHeader("content-type", "application/json"); return res.end("{}"); }
    if (req.url === "/bad/chat/completions") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "bad key" } })); }
    res.setHeader("content-type", "text/event-stream");
    const chunks = req.url!.startsWith("/anth")
      ? [
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]
      : [
          'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"con',
          'tent":"lo"}}]}\r\n\r\n',
          "data: [DONE]\n\n",
        ];
    let i = 0;
    const next = () => { if (i < chunks.length) { res.write(chunks[i++]); setTimeout(next, 5); } else res.end(); };
    next();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const base = `http://localhost:${port}`;
const assert = (c: boolean, m: string) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };

const mk = (kind: any, baseUrl: string, extra: any = {}) => ({
  ...DEFAULT_SETTINGS,
  connections: [{ id: "c1", name: "Test", kind, baseUrl, apiKey: "k" }],
  defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "sm" } },
  ...extra,
});
const conn = (kind: any, baseUrl: string) => mk(kind, baseUrl).connections[0];

let out = await completeChat(mk("ollama", base + "/o/v1".replace("/v1","")) as any, { system: "sys", messages: [{ role: "user", content: "hi" }] });
assert(out === "Hello", "openai-compatible stream (split chunks, CRLF): " + JSON.stringify(out));
assert(seen.at(-1)!.url === "/o/chat/completions", "openai url " + seen.at(-1)!.url);
assert(seen.at(-1)!.body.messages[0].role === "system" && seen.at(-1)!.body.stream === true, "system msg + stream flag");
assert(seen.at(-1)!.headers!.authorization === "Bearer k", "bearer auth");
assert(!("temperature" in seen.at(-1)!.body), "no temperature when null");

out = await completeChat(mk("anthropic", base + "/anth/v1", { temperature: 0.7 }) as any, { system: "sys", messages: [{ role: "user", content: "hi" }], role: "cheap" });
assert(out === "Hello", "anthropic stream: " + out);
const a = seen.at(-1)!;
assert(a.url === "/anth/v1/messages" && a.headers!["x-api-key"] === "k" && a.headers!["anthropic-dangerous-direct-browser-access"] === "true", "anthropic url+headers");
assert(a.body.system === "sys" && a.body.max_tokens === 4096 && a.body.model === "sm" && a.body.temperature === 0.7, "anthropic body (summary model, temp, max_tokens)");

assert(JSON.stringify(await listModels(conn("custom", base + "/o"))) === '["a-model","b-model"]', "listModels sorted");
try { await completeChat(mk("custom", base + "/bad") as any, { messages: [{ role: "user", content: "x" }] }); assert(false, "should throw"); }
catch (e) { assert(e instanceof AiError && String(e.message).includes("401") && String(e.message).includes("bad key"), "HTTP error surfaced: " + (e as Error).message); }
try { await completeChat(mk("custom", "http://localhost:1") as any, { messages: [{ role: "user", content: "x" }] }); }
catch (e) { assert(e instanceof AiError && /CORS/.test((e as Error).message), "network error hint"); }
try { await completeChat({ ...DEFAULT_SETTINGS } as any, { messages: [] }); assert(false, "no model"); }
catch (e) { assert(/No model is chosen/.test((e as Error).message), "no default model message"); }
try { await completeChat(mk("anthropic", base, { connections: [{ id: "c1", name: "A", kind: "anthropic", baseUrl: base, apiKey: "" }] }) as any, { messages: [] }); assert(false, "no key"); }
catch (e) { assert(/API key is set for A/.test((e as Error).message), "missing key message names the connection"); }

// Picking a model: an explicit one wins over the defaults, and can be on another connection.
const two = mk("ollama", base + "/o", {
  connections: [
    { id: "c1", name: "One", kind: "ollama", baseUrl: base + "/o", apiKey: "" },
    { id: "c2", name: "Two", kind: "openrouter", baseUrl: base + "/r", apiKey: "rk" },
  ],
});
await completeChat(two as any, { messages: [{ role: "user", content: "x" }], role: "cheap", model: { connectionId: "c2", model: "vendor/big" } });
assert(seen.at(-1)!.url === "/r/chat/completions" && seen.at(-1)!.body.model === "vendor/big" && seen.at(-1)!.headers!.authorization === "Bearer rk", "explicit model on another connection");
await completeChat(two as any, { messages: [{ role: "user", content: "x" }], role: "cheap" });
assert(seen.at(-1)!.url === "/o/chat/completions" && seen.at(-1)!.body.model === "sm", "role cheap uses the cheaper default");
await completeChat({ ...two, defaults: { main: two.defaults.main, cheap: null } } as any, { messages: [{ role: "user", content: "x" }], role: "cheap" });
assert(seen.at(-1)!.body.model === "m", "no cheaper default falls back to the main one");
try { await completeChat(two as any, { messages: [], model: { connectionId: "gone", model: "x" } }); assert(false, "gone"); }
catch (e) { assert(/has been removed/.test((e as Error).message), "a model on a removed connection is reported"); }
// Disable thinking is set per starred model. OpenRouter gets its own reasoning object.
const fav = (connectionId: string, model: string, disableThinking: boolean) => ({ connectionId, model, label: "", disableThinking, hiddenFrom: [] });
const thinking = { ...two, favorites: [fav("c2", "vendor/big", true), fav("c1", "m", true), fav("c1", "sm", false)] };
await completeChat(thinking as any, { messages: [{ role: "user", content: "x" }], model: { connectionId: "c2", model: "vendor/big" } });
assert(seen.at(-1)!.body.reasoning?.effort === "none" && !("reasoning_effort" in seen.at(-1)!.body), "openrouter: reasoning effort none");
await completeChat(thinking as any, { messages: [{ role: "user", content: "x" }] });
assert(seen.at(-1)!.body.reasoning_effort === "none" && !("reasoning" in seen.at(-1)!.body), "others: reasoning_effort none");
await completeChat(thinking as any, { messages: [{ role: "user", content: "x" }], role: "cheap" });
assert(seen.at(-1)!.body.model === "sm" && !("reasoning_effort" in seen.at(-1)!.body) && !("reasoning" in seen.at(-1)!.body), "a model with thinking left on is asked nothing about it, though another model has it off");
await completeChat({ ...two, favorites: [] } as any, { messages: [{ role: "user", content: "x" }] });
assert(!("reasoning_effort" in seen.at(-1)!.body), "a model that isn't starred is left to think");
const ctl = new AbortController(); ctl.abort();
try { await completeChat(mk("custom", base + "/o") as any, { messages: [{ role: "user", content: "x" }], signal: ctl.signal }); assert(false, "abort"); }
catch (e) { assert((e as any).name === "AbortError", "abort propagates"); }

// Freeing ComfyUI's memory first, for a connection that asks for it.
const local = (freeComfy: boolean, comfyUrl: string) => ({
  ...mk("ollama", base + "/o"),
  connections: [{ id: "c1", name: "Local", kind: "ollama", baseUrl: base + "/o", apiKey: "", freeComfy }],
  comfy: { ...DEFAULT_SETTINGS.comfy, url: comfyUrl },
});
const urlsOf = async (s: any) => {
  const from = seen.length;
  const text = await completeChat(s, { messages: [{ role: "user", content: "x" }] });
  return { text, urls: seen.slice(from).map((x) => x.url) };
};
let r = await urlsOf(local(true, base + "/comfy/"));
assert(r.text === "Hello" && JSON.stringify(r.urls) === '["/comfy/free","/o/chat/completions"]', "freeComfy: ComfyUI is asked to free its memory, then the text request is sent: " + JSON.stringify(r.urls));
const free = seen.find((x) => x.url === "/comfy/free")!;
assert(free.body.unload_models === true && free.body.free_memory === true, "…asking it to unload its models and free memory");
r = await urlsOf(local(false, base + "/comfy"));
assert(JSON.stringify(r.urls) === '["/o/chat/completions"]', "a connection without the setting doesn't touch ComfyUI");
r = await urlsOf(local(true, ""));
assert(r.text === "Hello" && JSON.stringify(r.urls) === '["/o/chat/completions"]', "with no ComfyUI address the setting does nothing");
r = await urlsOf(local(true, "http://localhost:1"));
assert(r.text === "Hello", "a ComfyUI that can't be reached doesn't stop the text request");
assert(parseSettings({ connections: [{ id: "a", kind: "ollama" }] }).connections[0].freeComfy === false, "settings saved before the option have it off");
assert(parseSettings({ connections: [{ id: "a", kind: "ollama", freeComfy: true }] }).connections[0].freeComfy === true, "…and it is kept when on");

// Unloading Ollama's models before a picture job: the native API sits beside /v1, not under it.
assert(ollamaRoot("http://localhost:11434/v1") === "http://localhost:11434" && ollamaRoot(" http://h:1/v1/ ") === "http://h:1" && ollamaRoot("http://h:1") === "http://h:1" && ollamaRoot("http://h:1/proxy/v1") === "http://h:1/proxy", "ollamaRoot drops a trailing /v1 (and slashes, spaces) and keeps a path before it");
let from = seen.length;
assert((await freeOllamaMemory(base + "/ol/v1")) === true, "freeOllamaMemory reports it unloaded something");
assert(JSON.stringify(seen.slice(from).map((x) => x.url)) === '["/ol/api/ps","/ol/api/generate","/ol/api/generate"]', "…listing the loaded models, then one unload call each");
assert(JSON.stringify(seen.slice(from + 1).map((x) => x.body).sort((a, b) => a.model.localeCompare(b.model))) === '[{"model":"big:14b","keep_alive":0},{"model":"tiny:1b","keep_alive":0}]', "…with keep_alive 0 for each model");
assert((await freeOllamaMemory("http://localhost:1/v1")) === false, "an Ollama that can't be reached is not an error");
from = seen.length;
await freeOllamaForPictures([
  { ...conn("ollama", base + "/ol/v1"), freeForPictures: true },
  { ...conn("ollama", base + "/o/v1"), freeForPictures: false },
  { ...conn("openai", base + "/o/v1"), freeForPictures: true },
] as any);
assert(seen.slice(from).every((x) => x.url!.startsWith("/ol/")) && seen.length > from, "only Ollama connections with the box ticked are unloaded");
assert(parseSettings({ connections: [{ id: "a", kind: "ollama" }] }).connections[0].freeForPictures === false && parseSettings({ connections: [{ id: "a", kind: "ollama", freeForPictures: true }] }).connections[0].freeForPictures === true, "freeForPictures is off in older settings and kept when on");

// settings parse / export / import
assert(parseSettings(null).contextTokens === 8000, "parse null -> defaults");
const messy = parseSettings({
  temperature: 9,
  connections: [
    { id: "a", name: "A", kind: "nope", baseUrl: "u", apiKey: 3 },
    { name: "no id" },
    { id: "a", name: "dup" },
    { id: "b", kind: "openrouter" },
  ],
  favorites: [{ connectionId: "a", model: "x" }, { connectionId: "a", model: "x" }, { connectionId: "zz", model: "y" }, { connectionId: "b", model: " " }],
  defaults: { main: { connectionId: "zz", model: "y" }, cheap: { connectionId: "a", model: "x" } },
  activeProvider: "old-format",
});
assert(messy.temperature === null && messy.connections.length === 2 && messy.connections[0].kind === "custom" && messy.connections[0].apiKey === "" && messy.connections[1].kind === "openrouter", "tolerant parse: connections");
assert(messy.favorites.length === 1 && messy.favorites[0].label === "", "tolerant parse: favorites deduped, dangling ones dropped");
assert(messy.defaults.main === null && messy.defaults.cheap?.model === "x", "tolerant parse: defaults pointing at missing connections are cleared");

// Per-model thinking and jobs. The old global "Disable thinking" carries over to every starred model.
const conns = [{ id: "a", kind: "ollama" }];
const old = parseSettings({ connections: conns, disableThinking: true, favorites: [{ connectionId: "a", model: "x" }, { connectionId: "a", model: "y", disableThinking: false }] });
assert(old.favorites[0].disableThinking === true && old.favorites[1].disableThinking === false && !("disableThinking" in old), "the old global switch is moved onto starred models that have no setting of their own");
const fresh = parseSettings({ connections: conns, favorites: [{ connectionId: "a", model: "x" }] });
assert(fresh.favorites[0].disableThinking === false && fresh.favorites[0].hiddenFrom.length === 0, "a starred model starts thinking as usual and offered for every job");
const hidden = parseSettings({ connections: conns, favorites: [{ connectionId: "a", model: "x", hiddenFrom: ["summary", "summary", "nope", 3, "write"] }] });
assert(JSON.stringify(hidden.favorites[0].hiddenFrom) === '["write","summary"]', "jobs opted out of are kept once each, unknown ones dropped: " + JSON.stringify(hidden.favorites[0].hiddenFrom));
const picks = parseSettings({ connections: conns, favorites: [{ connectionId: "a", model: "big", hiddenFrom: ["summary", "suggest"] }, { connectionId: "a", model: "small" }] });
assert(favoritesFor(picks, "summary").map((f) => f.model).join() === "small" && favoritesFor(picks, "write").length === 2, "favoritesFor leaves out models opted out of the job");
assert(JSON.stringify(importSettingsJson(exportSettingsJson(picks)).favorites) === JSON.stringify(picks.favorites), "per-model settings survive export and import");
assert(!("activeProvider" in messy), "old fields are dropped");
const rt = importSettingsJson(exportSettingsJson({ ...DEFAULT_SETTINGS, contextTokens: 1234 }));
assert(rt.contextTokens === 1234, "export/import round-trip");
try { importSettingsJson('{"x":1}'); assert(false, "bad file"); } catch (e) { assert(/settings file/.test((e as Error).message), "rejects foreign file"); }
server.close();
