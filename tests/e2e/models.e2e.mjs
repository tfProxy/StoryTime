// AI connections and starred models are set up in Settings; each draft on the writing desk can pick its own
// model for writing and for its summary, which is remembered with the draft.
import http from "node:http";
import { launch, startStory } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
/** How many times the second connection's model list was asked for. */
let modelCalls = 0;
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.url.endsWith("/models")) {
    if (req.url.startsWith("/b/")) modelCalls++;
    res.setHeader("content-type", "application/json");
    const ids = req.url.startsWith("/a/") ? ["alpha", "beta"] : ["vendor/big", "vendor/small-v1.1", ...Array.from({ length: 20 }, (_, i) => `other/m${i}`)];
    return res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
  }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content;
    calls.push({ url: req.url, model: body.model, auth: req.headers.authorization, system, reasoning: body.reasoning ?? body.reasoning_effort });
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
// Start from the default settings.
await json("PUT", "/api/settings", {});

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
await ollama.getByRole("button", { name: "Test from server" }).click();
await ollama.getByText(/The server reached it\. 2 models available/).waitFor();
ok(true, "Test from server reaches the connection from the StoryTime server");
await ollama.getByRole("button", { name: "Use alpha" }).click();
await until(async () => (await settingsNow())?.defaults.main?.model === "alpha", "the first model used to become the default");
ok(await ollama.getByRole("button", { name: "Stop using alpha" }).getByText("✓ In use").isVisible(), "the first model put in use becomes the default, and its button says it is in use");

await page.getByLabel("Kind of connection").selectOption("openrouter");
await page.getByRole("button", { name: "Add connection" }).click();
const router = page.locator("fieldset.connection").nth(1);
ok((await router.getByLabel("Server URL").inputValue()) === "https://openrouter.ai/api/v1", "an OpenRouter connection starts with its URL filled in");
await router.getByLabel("Server URL").fill("http://localhost:3222/b/v1");
await router.getByLabel("API key").fill("rk");
await router.getByRole("button", { name: "Test connection" }).click();
await router.getByLabel("Search models").fill("vendor/b");
ok((await router.locator(".codex-pick").count()) === 1, "the fetched model list can be searched");
await router.getByLabel("Search models").fill("nothing-like-this");
ok(await router.getByText("No model matches “nothing-like-this”.").isVisible(), "…and says when nothing matches");
await router.getByLabel("Search models").fill("vendor/b");
await router.getByRole("button", { name: "Use vendor/big" }).click();

// The list folds away, and is remembered: after a reload it is there (folded) without asking the server again.
const routerList = router.locator("details.model-list");
await routerList.locator("summary").click();
ok(!(await router.getByLabel("Search models").isVisible()), "the model list folds away");
await until(async () => !!(await (await fetch(`${BASE}/api/model-lists/${(await settingsNow()).connections[1].id}`)).json()).list, "the list to be remembered on the server");
const asked = modelCalls;
await page.reload();
const routerAgain = page.locator("fieldset.connection").nth(1);
await routerAgain.locator("details.model-list summary").waitFor();
ok(/22 models\s*fetched today/.test(await routerAgain.locator("details.model-list summary").innerText()) && modelCalls === asked, "after a reload the fetched models are back, saying when they were fetched, without asking the provider again");
await routerAgain.locator("details.model-list summary").click();
await routerAgain.getByRole("button", { name: "Refresh", exact: true }).click();
ok(await until(async () => modelCalls === asked + 1, "Refresh to ask again"), "Refresh fetches the list again");

await page.getByRole("tab", { name: "Writing" }).click();
await page.getByLabel("Nickname for vendor/big").fill("Big one");
await until(async () => (await settingsNow())?.favorites.find((f) => f.model === "vendor/big")?.label === "Big one", "the nickname to be saved");
ok(true, "models in use are on the Writing tab, where they can be given a nickname");
ok((await page.locator("table.model-grid").count()) === 1 && (await page.locator("table.model-grid tbody tr").count()) === 2 && (await page.getByRole("heading", { name: "Models", exact: true }).count()) >= 1, "on the Writing tab the models in use are rows of one grid");

// ---- each starred model has a row: context, thinking, and per job whether it is offered and the default ----
const JOBS = ["Writing", "Choices", "Summaries", "Codex", "Tags & continuity", "Picture prompts"];
const bigRow = page.locator("table.model-grid tbody tr", { has: page.getByLabel("Nickname for vendor/big") });
const alphaRow = page.locator("table.model-grid tbody tr", { has: page.getByLabel("Nickname for alpha") });
ok((await bigRow.count()) === 1 && (await alphaRow.count()) === 1, "one row per starred model");
const offers = (row) => row.getByRole("checkbox", { name: /^Offer / });
ok((await offers(bigRow).count()) === JOBS.length && (await offers(bigRow).evaluateAll((xs) => xs.every((x) => x.checked))), "a starred model is offered for every job at first");
ok((await bigRow.getByRole("radio").count()) === JOBS.length, "…and has a default button for each job");
const thinking = bigRow.getByLabel("Thinking for vendor/big");
const shown = await thinking.locator("option").allTextContents();
ok((await thinking.locator("option:checked").textContent()) === "Think for everything", "…with thinking left on");
ok(shown.join(" / ") === "Think for everything / Only when writing chapters / Never think", `…and three choices: ${shown.join(" / ")}`);
await thinking.selectOption({ label: "Only when writing chapters" });
await until(async () => JSON.stringify((await settingsNow()).favorites.find((f) => f.model === "vendor/big")?.disableThinking) === '{"write":false,"other":true}', "thinking to be turned off for vendor/big's other jobs only");
ok((await settingsNow()).favorites.find((f) => f.model === "vendor/big").context === null, "a model's context starts blank (it uses the Context budget)");
await bigRow.getByLabel("Context for vendor/big").fill("32000");
await until(async () => (await settingsNow()).favorites.find((f) => f.model === "vendor/big")?.context === 32000, "the model's context to be saved");
ok(true, "a model can be given its own context");
await bigRow.getByRole("checkbox", { name: "Offer Big one for Summaries" }).uncheck();
await until(async () => (await settingsNow()).favorites.find((f) => f.model === "vendor/big")?.hiddenFrom.includes("summaries"), "vendor/big to opt out of summaries");
let bigFav = (await settingsNow()).favorites.find((f) => f.model === "vendor/big");
ok(bigFav.hiddenFrom.length === 1 && !(await bigRow.getByRole("checkbox", { name: "Offer Big one for Summaries" }).isChecked()) && (await bigRow.getByRole("checkbox", { name: "Offer Big one for Writing" }).isChecked()), "opting out of summaries only affects that job");
await bigRow.getByRole("checkbox", { name: "Offer Big one for Summaries" }).check();
await until(async () => (await settingsNow()).favorites.find((f) => f.model === "vendor/big")?.hiddenFrom.length === 0, "vendor/big to be offered for summaries again");
// (Left offered for Summaries: the desk's Summary model picker below picks it. Choices is opted out of instead.)
await bigRow.getByRole("checkbox", { name: "Offer Big one for Choices" }).uncheck();
await until(async () => (await settingsNow()).favorites.find((f) => f.model === "vendor/big")?.hiddenFrom.join() === "choices", "vendor/big to opt out of choices");
const alphaFav = (await settingsNow()).favorites.find((f) => f.model === "alpha");
ok(!alphaFav.disableThinking.write && !alphaFav.disableThinking.other && alphaFav.hiddenFrom.length === 0 && alphaFav.context === null, "the other model's row is untouched");
ok((await page.getByRole("combobox", { name: /^Thinking for / }).count()) === 2 && (await alphaRow.getByLabel("Thinking for alpha").inputValue()) === "none", "Thinking is chosen on each row");
// Choosing a default is a round button per job; the job's default is saved under its own key.
ok(await alphaRow.getByRole("radio", { name: "alpha: default for Writing" }).isChecked() && !(await bigRow.getByRole("radio", { name: "Big one: default for Writing" }).isChecked()), "the Writing default (alpha) is the one chosen");
await bigRow.getByRole("radio", { name: "Big one: default for Codex" }).check();
await until(async () => (await settingsNow()).defaults.codex?.model === "vendor/big", "the Codex default to be saved");
ok((await settingsNow()).defaults.main.model === "alpha", "choosing the Codex default leaves the Writing default alone");
await page.getByRole("tab", { name: "Connections" }).click();
let s = await settingsNow();
ok(s.connections.length === 2 && s.favorites.length === 2 && s.defaults.main.model === "alpha", "settings hold both connections and both starred models");

// A model added by the name a provider's website shows is starred under the id the server lists (NanoGPT).
await router.getByLabel(/Add a model by name/).fill("Vendor/Small v1.1");
await router.getByRole("button", { name: "Use", exact: true }).click();
await until(async () => (await settingsNow()).favorites.some((f) => f.model === "vendor/small-v1.1"), "the typed name to be used as its id");
ok(await router.getByText("Using vendor/small-v1.1, the id this server uses for “Vendor/Small v1.1”.").isVisible() && !(await settingsNow()).favorites.some((f) => f.model === "Vendor/Small v1.1"), "a model added by a name with spaces is used under the listed id, and the page says so");
if (!(await router.getByLabel("Search models").isVisible())) await router.locator("details.model-list summary").click();
await router.getByLabel("Search models").fill("vendor/s");
await router.getByRole("button", { name: "Stop using vendor/small-v1.1" }).click();
await until(async () => (await settingsNow()).favorites.length === 2, "vendor/small-v1.1 to be dropped again");

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
await page.locator(".desk-gen-row").getByRole("button", { name: "Generate" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
// (The server makes the request now, a moment after the click.)
await until(() => calls.some((c) => c.system.includes("Output format")), "the generate call");
let gen = calls.filter((c) => c.system.includes("Output format")).at(-1);
ok(gen.url === "/a/v1/chat/completions" && gen.model === "alpha", "generating uses the default model");
ok(gen.reasoning === undefined, "…which is left to think");

await writePicker.selectOption({ label: "Big one" });
await page.getByRole("button", { name: "Generate again" }).click();
await until(() => calls.filter((c) => c.system.includes("Output format")).length === 2, "the second generate call");
gen = calls.filter((c) => c.system.includes("Output format")).at(-1);
ok(gen.url === "/b/v1/chat/completions" && gen.model === "vendor/big" && gen.auth === "Bearer rk", "after picking another model, generating uses it, on its own connection");
ok(gen.reasoning === undefined, "…and is left to think, as its card turns thinking off only for other jobs");

await until(async () => (await json("GET", draftUrl)).draft?.models?.write?.model === "vendor/big", "the pick to be saved with the draft");
await page.reload();
await page.getByLabel("Chapter title").waitFor();
ok((await page.getByLabel("Model for writing").first().inputValue()).includes("vendor/big"), "the picked model is remembered with the draft");
ok((await settingsNow()).defaults.main.model === "alpha", "…without changing the default");

// ---- the summary has its own picker, in the desk's ⋯ menu ----
await page.locator(".desk-bar").getByLabel("More for this chapter").click();
const summaryPicker = page.locator(".desk-bar .more-menu-items").getByLabel("Summary model");
ok((await summaryPicker.inputValue()) === "", "the summary model starts on the default");
await summaryPicker.selectOption({ label: "Big one" });
await until(async () => (await json("GET", draftUrl)).draft?.models?.suggest?.model === "vendor/big", "the summary model's pick to be saved with the draft");
await page.locator(".desk-bar .more-menu > summary").click();
const before = calls.length;
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/desk\?posted=1$/);
await until(() => calls.slice(before).some((c) => c.system.includes("running summary")), "the summary call after posting");
const sum = calls.slice(before).find((c) => c.system.includes("running summary"));
ok(sum.model === "vendor/big", "the summary written after posting uses the model picked for it");
ok(sum.reasoning?.effort === "none", "…and the same model is asked not to think for it, as set on its card");

// ---- the default is chosen in Settings, not next to the picker ----
ok((await page.getByRole("button", { name: "Make default" }).count()) === 0, "the picker has no “Make default” button");
await page.goto(`${BASE}/settings#writing`);
await page.getByRole("radio", { name: "Big one: default for Writing" }).check();
await until(async () => (await settingsNow()).defaults.main?.model === "vendor/big", "the default to change");
ok(true, "choosing the Writing default in Settings changes it");

// ---- removing a connection drops its starred models ----
await page.goto(`${BASE}/settings`);
await page.locator("fieldset.connection").nth(1).getByRole("button", { name: "Remove connection" }).click();
await until(async () => (await settingsNow()).connections.length === 1, "the connection to be removed");
s = await settingsNow();
ok(s.favorites.length === 1 && s.favorites[0].model === "alpha" && s.defaults.main === null && s.defaults.codex === null, "removing a connection drops its starred models and the defaults that used it");

await fetch(`${BASE}${draftUrl}`, { method: "DELETE" });
await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
