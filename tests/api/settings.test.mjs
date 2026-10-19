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

r = await call("PUT", "/api/settings", { connections: "bogus", defaults: { main: { connectionId: "nope", model: "m" } }, contextTokens: 5 });
ok(r.status === 200 && r.json.settings.connections.length === 0 && r.json.settings.defaults.main === null && r.json.settings.contextTokens === 8000, "invalid fields fall back to defaults");

ok((await call("PUT", "/api/settings", [])).status === 400, "a non-object body is rejected");
