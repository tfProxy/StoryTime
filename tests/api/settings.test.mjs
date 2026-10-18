// Settings are stored on the server, so every session sees the same ones.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("GET", "/api/settings");
ok(r.status === 200 && r.json.settings === null, "no settings until some are saved");

r = await call("PUT", "/api/settings", { activeProvider: "ollama", contextTokens: 4000, providers: { ollama: { baseUrl: "http://x/v1", apiKey: "k", model: "m", summaryModel: "" } } });
ok(r.status === 200 && r.json.settings.activeProvider === "ollama", "settings can be saved");

r = await call("GET", "/api/settings");
ok(r.json.settings.contextTokens === 4000 && r.json.settings.providers.ollama.apiKey === "k", "a later request gets them back");
ok(r.json.settings.providers.anthropic.model !== undefined, "missing parts are filled with defaults");
ok(r.json.settings.autoSuggestChoices === false, "suggesting choices after writing is off unless asked for");
r = await call("PUT", "/api/settings", { autoSuggestChoices: true });
ok(r.json.settings.autoSuggestChoices === true && (await call("GET", "/api/settings")).json.settings.autoSuggestChoices === true, "…and can be turned on");
r = await call("PUT", "/api/settings", { activeProvider: "ollama", contextTokens: 4000, providers: { ollama: { baseUrl: "http://x/v1", apiKey: "k", model: "m", summaryModel: "" } } });

r = await call("PUT", "/api/settings", { activeProvider: "bogus", contextTokens: 5 });
ok(r.status === 200 && r.json.settings.activeProvider === "anthropic" && r.json.settings.contextTokens === 8000, "invalid fields fall back to defaults");

ok((await call("PUT", "/api/settings", [])).status === 400, "a non-object body is rejected");
