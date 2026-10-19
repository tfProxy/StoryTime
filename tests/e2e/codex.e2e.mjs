import http from "node:http";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    prompts.push(JSON.parse(data || "{}").messages?.at(-1)?.content ?? "");
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "# T\n\nHello there." } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// root -> A (choice A2 unwritten), root -> B
const story = await post("/api/stories", { title: "Horse Tale", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go to A", "Go to B"] } });
const root = story.chapter_id;
const choices = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices;
const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Mira trotted.", choices: ["Gallop"] })).chapter_id;
const B = (await post("/api/chapters", { choice_id: choices[1].id, title: "Chapter B", body: "Quiet." })).chapter_id;
const gallop = (await (await fetch(`${BASE}/api/chapters/${A}`)).json()).choices[0];

const browser = await launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  if (!localStorage.getItem("storytime.settings.v1")) {
    localStorage.setItem("storytime.settings.v1", JSON.stringify({ connections: [{ id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" }], defaults: { main: { connectionId: "t", model: "m" }, cheap: null } }));
  }
});
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// create an entry at the root
await page.goto(`${BASE}/c/${root}/codex`);
await page.getByRole("button", { name: "+ New entry" }).click();
await page.getByLabel("Name", { exact: true }).fill("Mira");
await page.locator("form.ai-panel select").first().selectOption("character");
await page.getByLabel(/Other names/).fill("the thief, Mir");
await page.getByLabel(/Description/).fill("A human thief with a scar.");
await page.getByLabel(/Always include/).check();
await page.getByRole("button", { name: "Add entry" }).click();
await page.locator("article").getByText("A human thief with a scar.").first().waitFor();
ok(await page.getByText("changed in this chapter").isVisible(), "new entry shows 'changed in this chapter'");
ok(await page.getByText("Also: the thief, Mir").isVisible(), "aliases shown");

// inherited in A; edit there
await page.goto(`${BASE}/c/${A}/codex`);
await page.locator("article").getByText("A human thief with a scar.").first().waitFor();
ok((await page.getByText("changed in this chapter").count()) === 0, "inherited entry isn't marked as changed here");
ok(await page.getByText(/Last changed in “Root”/).isVisible(), "shows where it last changed");
await page.getByRole("button", { name: "Edit" }).click();
await page.getByLabel(/Description/).fill("Now a horse. Cannot speak.");
await page.getByRole("button", { name: "Save changes" }).click();
await page.locator("article").getByText("Now a horse. Cannot speak.").first().waitFor();
ok(await page.getByText("changed in this chapter").isVisible(), "edit at A is anchored at A");

// history + restore
await page.getByRole("button", { name: /History \(2\)/ }).click();
ok(await page.getByText(/Changed/).first().isVisible() && await page.getByText(/content/).first().isVisible(), "history lists the change");
await page.getByRole("button", { name: "Restore this version" }).click();
await page.locator("article").getByText("A human thief with a scar.").first().waitFor();
await page.locator("ol.history li").nth(2).waitFor();
ok(true, "restore adds a new version (history now 3)");
// put the horse back for the isolation checks
await page.getByRole("button", { name: "Edit" }).click();
await page.getByLabel(/Description/).fill("Now a horse. Cannot speak.");
await page.getByRole("button", { name: "Save changes" }).click();
await page.locator("article").getByText("Now a horse. Cannot speak.").first().waitFor();

// branch isolation
await page.goto(`${BASE}/c/${B}/codex`);
await page.locator("article").getByText("A human thief with a scar.").first().waitFor();
ok((await page.getByText("Now a horse").count()) === 0, "branch B still sees the human Mira");
await page.goto(`${BASE}/c/${root}/codex`);
ok((await page.getByText("Now a horse").count()) === 0, "root unaffected by the change at A");

// prompts carry the branch's codex
await page.goto(`${BASE}/c/${A}/write?choice=${gallop.id}`);
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Hello there"));
const p = prompts.at(-1);
ok(p.includes("Mira [character] (also: the thief, Mir): Now a horse. Cannot speak."), "continuation on A gets the horse entry");
ok(!p.includes("human thief with a scar"), "…and not the old version");
await page.goto(`${BASE}/c/${B}`);
await page.getByRole("link", { name: "Draft a different idea" }).click();
await page.getByLabel(/Choice text/).fill("Wander");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).click();
await page.waitForFunction(() => document.querySelector("textarea[maxlength='50000']")?.value.includes("Hello there"));
ok(prompts.at(-1).includes("A human thief with a scar."), "continuation on B gets the human entry");

// retire at A
await page.goto(`${BASE}/c/${A}/codex`);
await page.getByRole("button", { name: "Retire" }).click();
await page.getByRole("heading", { name: "Retired" }).waitFor();
ok((await page.getByText("Now a horse").count()) === 0, "retired entry leaves the list");
await page.getByRole("button", { name: "Bring back" }).click();
await page.locator("article").getByText("Now a horse. Cannot speak.").first().waitFor();
ok(true, "bring back restores it");
await page.goto(`${BASE}/c/${A}`);
await page.locator(".site-menu > summary").click();
ok(await page.getByRole("link", { name: "Codex" }).isVisible(), "codex link in the chapter page menu");

await browser.close(); mock.close();
process.exit(failed ? 1 : 0);
