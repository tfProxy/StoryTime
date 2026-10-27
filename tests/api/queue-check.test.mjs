// Settings › "Test from server": the server reaches ComfyUI or an AI provider and says what it found, or why not.
import { startFakeAi } from "../fakeAi.mjs";
import { startFakeComfy } from "../e2e/fakeComfy.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const check = async (body) => {
  const r = await fetch(`${B}/api/queue/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const comfy = await startFakeComfy({ port: 3564, checkpoints: ["a.safetensors", "b.safetensors"] });
const ai = await startFakeAi({ port: 3565 });
try {
  let r = await check({ kind: "comfy", url: comfy.url });
  ok(r.status === 200 && r.json.ok === true && /reached ComfyUI/.test(r.json.text) && /2 checkpoints/.test(r.json.text), `the server reaches ComfyUI and counts its checkpoints (${r.json?.text})`);
  r = await check({ kind: "comfy", url: "http://localhost:1" });
  ok(r.status === 200 && r.json.ok === false && /couldn't reach http:\/\/localhost:1/.test(r.json.text), `…and says when it cannot (${r.json?.text})`);
  r = await check({ kind: "comfy", url: "comfy.local:8188" });
  ok(r.json.ok === false && /http:\/\/ or https:\/\//.test(r.json.text), "an address without http:// is refused with a sentence");
  r = await check({ kind: "ai", provider: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k" });
  ok(r.status === 200 && r.json.ok === true && /reached it/.test(r.json.text), `the server reaches an AI provider's model list (${r.json?.text})`);
  r = await check({ kind: "ai", provider: "custom", baseUrl: "http://localhost:1/v1", apiKey: "" });
  ok(r.json.ok === false && /couldn't reach/.test(r.json.text), "…and says when it cannot");
  r = await check({ kind: "nope" });
  ok(r.status === 400, "a request that is not one of the two kinds is a 400");
} finally {
  await comfy.close();
  await ai.close();
}
