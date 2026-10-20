// AI connections and starred models are set up in Settings; each draft can pick its own
// model for writing and for suggestions, which is remembered with the draft.
import http from "node:http";
import { launch, startStory } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    const ids = req.url.startsWith("/a/") ? ["alpha", "beta"] : ["vendor/big", "vendor/small", ...Array.from({ length: 20 }, (_, i) => `other/m${i}`)];
    return res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
  }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content;
    calls.push({ url: req.url, model: body.model, auth: req.headers.authorization, system });
    let text = "# Generated\n\nGenerated text here.";
    if (system.includes("running summary")) text = JSON.stringify({ summary: "S", story_so_far: "SF" });
    else if (system.includes("button text and nothing else")) text = "Carry on";
    else if (system.includes("JSON array of strings")) text = JSON.stringify(["Go left", "Go right"]);
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
const settingsNow = async () => (await json("GET", "/api/settings")).settings;
const until = async (fn, what) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const settingsBefore = await settingsNow();
await json("PUT", "/api/settings", { autoSuggestChoices: false });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- Settings: two connections, star a model on each ----
await page.goto(`${BASE}/settings`);
await page.getByLabel("Kind of connection").selectOption("ollama");
await page.getByRole("button", { name: "Add connection" }).click();
const ollama = page.locator("fieldset.connection").nth(0);
await ollama.getByLabel("Server URL").fill("http://localhost:3222/a/v1");
await ollama.getByRole("button", { name: "Test connection" }).click();
await ollama.getByText("Connected. 2 models").waitFor();
await ollama.getByRole("button", { name: "Star alpha" }).click();
await until(async () => (await settingsNow())?.defaults.main?.model === "alpha", "the first starred model to become the default");
ok(true, "the first model starred becomes the default");

await page.getByLabel("Kind of connection").selectOption("openrouter");
await page.getByRole("button", { name: "Add connection" }).click();
const router = page.locator("fieldset.connection").nth(1);
ok((await router.getByLabel("Server URL").inputValue()) === "https://openrouter.ai/api/v1", "an OpenRouter connection starts with its URL filled in");
await router.getByLabel("Server URL").fill("http://localhost:3222/b/v1");
await router.getByLabel("API key").fill("rk");
await router.getByRole("button", { name: "Test connection" }).click();
await router.getByLabel("Filter models").fill("vendor/b");
ok((await router.locator(".codex-pick").count()) === 1, "a long model list can be filtered");
await router.getByRole("button", { name: "Star vendor/big" }).click();
await page.getByLabel("Nickname for vendor/big").fill("Big one");
await until(async () => (await settingsNow())?.favorites.find((f) => f.model === "vendor/big")?.label === "Big one", "the nickname to be saved");
let s = await settingsNow();
ok(s.connections.length === 2 && s.favorites.length === 2 && s.defaults.main.model === "alpha", "settings hold both connections and both starred models");

// ---- freeing ComfyUI's memory: per connection, and settable with no ComfyUI set up ----
const freeBox = (conn) => conn.getByRole("checkbox", { name: "Free ComfyUI's memory before each request" });
ok(await freeBox(ollama).count() === 1 && await freeBox(router).count() === 1 && !(await freeBox(ollama).isChecked()), "each connection has its own Free ComfyUI's memory box, off at first");
ok(s.comfy.url === "", "(no ComfyUI address is set)");
await freeBox(ollama).check();
ok(await until(async () => (await settingsNow()).connections[0].freeComfy === true, "the box to be saved"), "it can be ticked without a ComfyUI address, and is saved for that connection");
s = await settingsNow();
ok(s.connections[1].freeComfy === false, "…and only that one");

// ---- a draft uses the default, then a model picked on the page ----
const storyId = await startStory(page, BASE, { title: "Model tale" });
const draftUrl = `/api/drafts/first:${storyId}`;
const writePicker = page.getByLabel("Model for writing").first();
ok((await writePicker.inputValue()) === "", "the writing model starts on the default");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
let gen = calls.filter((c) => c.system.includes("Output format")).at(-1);
ok(gen.url === "/a/v1/chat/completions" && gen.model === "alpha", "generating uses the default model");

await writePicker.selectOption({ label: "Big one" });
await page.getByRole("button", { name: "Generate a new draft" }).click();
await until(() => calls.filter((c) => c.system.includes("Output format")).length === 2, "the second generate call");
gen = calls.filter((c) => c.system.includes("Output format")).at(-1);
ok(gen.url === "/b/v1/chat/completions" && gen.model === "vendor/big" && gen.auth === "Bearer rk", "after picking another model, generating uses it, on its own connection");

await until(async () => (await json("GET", draftUrl)).draft?.models?.write?.model === "vendor/big", "the pick to be saved with the draft");
await page.reload();
await page.getByLabel("Chapter title").waitFor();
ok((await page.getByLabel("Model for writing").first().inputValue()).includes("vendor/big"), "the picked model is remembered with the draft");
ok((await settingsNow()).defaults.main.model === "alpha", "…without changing the default");

// ---- suggestions have their own picker ----
// The Brainstorm panel (which has one too) is folded away once there is a chapter.
const suggestPicker = page.locator('select[aria-label="Model for suggestions"]:visible').first();
await page.getByRole("button", { name: "Suggest choices" }).click();
await until(() => calls.some((c) => c.system.includes("JSON array of strings")), "a suggest-choices call");
const before = calls.length;
ok(calls.at(-1).model === "alpha", "suggestions fall back to the default when no cheaper model is set");
await suggestPicker.selectOption({ label: "Big one" });
await page.getByRole("button", { name: "Suggest choices" }).click();
await until(() => calls.length > before, "the second suggest-choices call");
ok(calls.at(-1).model === "vendor/big", "suggestions use the model picked for them");

// ---- the default is chosen in Settings, not next to the picker ----
ok((await page.getByRole("button", { name: "Make default" }).count()) === 0, "the picker has no “Make default” button");
await page.goto(`${BASE}/settings`);
await page.getByLabel(/^Default model/).selectOption({ index: 2 }); // after the blank entry and "alpha"
await until(async () => (await settingsNow()).defaults.main?.model === "vendor/big", "the default to change");
ok(true, "choosing the default model in Settings changes it");

// ---- removing a connection drops its starred models ----
await page.goto(`${BASE}/settings`);
await page.locator("fieldset.connection").nth(1).getByRole("button", { name: "Remove connection" }).click();
await until(async () => (await settingsNow()).connections.length === 1, "the connection to be removed");
s = await settingsNow();
ok(s.favorites.length === 1 && s.favorites[0].model === "alpha" && s.defaults.main === null, "removing a connection drops its starred models and the default that used it");

await fetch(`${BASE}${draftUrl}`, { method: "DELETE" });
await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
