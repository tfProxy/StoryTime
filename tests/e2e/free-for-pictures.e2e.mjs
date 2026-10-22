// Unloading Ollama's models before a picture job: the box on an Ollama connection in Settings, and a job
// queued with it ticked asks the (fake) Ollama what is loaded and unloads it before ComfyUI gets the prompt.
import http from "node:http";
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3562;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 2, stepDelay: 60, startDelay: 100 });
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").length;
// A fake Ollama: what it was asked, and how many prompts ComfyUI had by then.
const asked = [];
const ollama = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    asked.push({ method: req.method, url: req.url, body: data ? JSON.parse(data) : null, prompts: posted() });
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/api/ps" ? JSON.stringify({ models: [{ name: "writer:14b", model: "writer:14b" }] }) : "{}");
  });
});
await new Promise((r) => ollama.listen(3223, r));

const story = await call("POST", "/api/stories", { title: "Unload tale", chapter: { title: "The pier", body: "Waves.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
const conn = (id, kind, baseUrl) => ({ id, name: id, kind, baseUrl, apiKey: "", freeComfy: false });
await putSettings({
  ...(before ?? {}),
  connections: [conn("local", "ollama", "http://localhost:3223/v1"), conn("cloud", "openrouter", "https://openrouter.ai/api/v1")],
  favorites: [],
  comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }),
});

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1200 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const box = (name) => page.getByRole("group", { name }).getByRole("checkbox", { name: "Unload this server's models before each picture job" });

try {
  await page.goto(`${BASE}/settings`);
  await page.locator("#comfyui").waitFor();
  await page.getByRole("group", { name: "cloud" }).waitFor();
  ok((await box("local").count()) === 1 && (await box("cloud").count()) === 0, "only the Ollama connection has the Unload box");
  ok(!(await box("local").isChecked()), "…off at first");
  await box("local").check();
  ok(await until(async () => (await call("GET", "/api/settings")).settings.connections[0].freeForPictures === true, "the box to be saved"), "ticking it is saved for that connection");

  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a pier at dusk");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => posted() === 1, "the job to be sent to ComfyUI", 60);
  ok(asked[0]?.method === "GET" && asked[0].url === "/api/ps", "Ollama is asked which models are loaded");
  const gen = asked.filter((a) => a.url === "/api/generate");
  ok(gen.length === 1 && gen[0].method === "POST" && gen[0].body.model === "writer:14b" && gen[0].body.keep_alive === 0, "…and the loaded model is unloaded (keep_alive 0)");
  ok(asked.every((a) => a.prompts === 0), "…all before ComfyUI got the prompt");

  // ---- off again: nothing is asked ----
  const now = (await call("GET", "/api/settings")).settings;
  await putSettings({ ...now, connections: now.connections.map((c) => ({ ...c, freeForPictures: false })) });
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  const count = asked.length;
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => posted() === 2, "the second job to be sent", 60);
  ok(asked.length === count, "with the box off, Ollama is not asked");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
  ollama.close();
}
process.exit(failed ? 1 : 0);
