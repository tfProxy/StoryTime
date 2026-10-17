import http from "node:http";
import { streamChat, listModels, completeChat, AiError } from "../../src/lib/ai/client.ts";
import { DEFAULT_SETTINGS, parseSettings, exportSettingsJson, importSettingsJson } from "../../src/lib/settingsSchema.ts";

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

const mk = (id: any, baseUrl: string, extra: any = {}) => ({
  ...DEFAULT_SETTINGS, activeProvider: id,
  providers: { ...DEFAULT_SETTINGS.providers, [id]: { baseUrl, apiKey: "k", model: "m", summaryModel: "sm" } }, ...extra,
});

let out = await completeChat(mk("ollama", base + "/o/v1".replace("/v1","")) as any, { system: "sys", messages: [{ role: "user", content: "hi" }] });
assert(out === "Hello", "openai-compatible stream (split chunks, CRLF): " + JSON.stringify(out));
assert(seen.at(-1)!.url === "/o/chat/completions", "openai url " + seen.at(-1)!.url);
assert(seen.at(-1)!.body.messages[0].role === "system" && seen.at(-1)!.body.stream === true, "system msg + stream flag");
assert(seen.at(-1)!.headers!.authorization === "Bearer k", "bearer auth");
assert(!("temperature" in seen.at(-1)!.body), "no temperature when null");

out = await completeChat(mk("anthropic", base + "/anth/v1", { temperature: 0.7 }) as any, { system: "sys", messages: [{ role: "user", content: "hi" }], useSummaryModel: true });
assert(out === "Hello", "anthropic stream: " + out);
const a = seen.at(-1)!;
assert(a.url === "/anth/v1/messages" && a.headers!["x-api-key"] === "k" && a.headers!["anthropic-dangerous-direct-browser-access"] === "true", "anthropic url+headers");
assert(a.body.system === "sys" && a.body.max_tokens === 4096 && a.body.model === "sm" && a.body.temperature === 0.7, "anthropic body (summary model, temp, max_tokens)");

assert(JSON.stringify(await listModels(mk("custom", base + "/o") as any)) === '["a-model","b-model"]', "listModels sorted");
try { await completeChat(mk("custom", base + "/bad") as any, { messages: [{ role: "user", content: "x" }] }); assert(false, "should throw"); }
catch (e) { assert(e instanceof AiError && String(e.message).includes("401") && String(e.message).includes("bad key"), "HTTP error surfaced: " + (e as Error).message); }
try { await completeChat(mk("custom", "http://localhost:1") as any, { messages: [{ role: "user", content: "x" }] }); }
catch (e) { assert(e instanceof AiError && /CORS/.test((e as Error).message), "network error hint"); }
try { await completeChat({ ...DEFAULT_SETTINGS } as any, { messages: [] }); }
catch (e) { assert(/API key/.test((e as Error).message), "missing key message"); }
const ctl = new AbortController(); ctl.abort();
try { await completeChat(mk("custom", base + "/o") as any, { messages: [{ role: "user", content: "x" }], signal: ctl.signal }); assert(false, "abort"); }
catch (e) { assert((e as any).name === "AbortError", "abort propagates"); }

// settings parse / export / import
assert(parseSettings(null).contextTokens === 8000, "parse null -> defaults");
const messy = parseSettings({ temperature: 9, providers: { openai: { apiKey: "sk-1", model: 3 } }, activeProvider: "nope" });
assert(messy.temperature === null && messy.activeProvider === "anthropic" && messy.providers.openai.apiKey === "sk-1" && messy.providers.openai.model === "" && messy.providers.anthropic.model === "claude-sonnet-5-5", "tolerant parse");
const rt = importSettingsJson(exportSettingsJson({ ...DEFAULT_SETTINGS, contextTokens: 1234 }));
assert(rt.contextTokens === 1234, "export/import round-trip");
try { importSettingsJson('{"x":1}'); assert(false, "bad file"); } catch (e) { assert(/settings file/.test((e as Error).message), "rejects foreign file"); }
server.close();
