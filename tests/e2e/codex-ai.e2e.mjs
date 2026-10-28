import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

// Drafting a single entry with the AI (the codex check and its inbox are in codex-inbox.e2e.mjs).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    calls.push({ system, user, model: body.model });
    let out;
    if (user.includes("Chapters since the entry was last updated")) {
      out = { name: "Gideon", type: "character", aliases: [], content: "A smith who now keeps the inn.", always_include: false, changed_in: 1 };
    } else {
      out = { name: "Old Tam", type: "character", aliases: ["the ferryman"], content: "A grizzled ferryman.", always_include: false };
    }
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Here you go:\n```json\n" + JSON.stringify(out) + "\n```" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

async function makeStory(title, rootTitle, rootBody, aTitle, aBody) {
  const s = await post("/api/stories", { title, chapter: { title: rootTitle, body: rootBody, choices: ["Onward"] } });
  const choice = (await getJson(`/api/chapters/${s.chapter_id}`)).choices[0];
  const a = await post("/api/chapters", { choice_id: choice.id, title: aTitle, body: aBody });
  return { root: s.chapter_id, a: a.chapter_id };
}
const s1 = await makeStory("Single", "Start", "Mira stood in the market. Bram the smith waved.", "Horse", "Mira had turned into a horse.");
await post("/api/codex", { anchor_chapter_id: s1.root, op: "create", name: "Gideon", type: "character", content: "A smith." });

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- after posting: the banner leads to the codex page with the check panel open ----
await page.goto(`${BASE}/c/${s1.a}?posted=1`);
ok(await page.getByRole("link", { name: "Review codex for this chapter" }).isVisible(), "post-publish banner offers a codex review");
await page.getByRole("link", { name: "Review codex for this chapter" }).click();
await page.waitForURL(/codex\?review=1/);
ok(await page.locator("details.ai-panel").evaluate((d) => d.open), "review link opens the codex check panel");
ok(await page.getByRole("button", { name: "Check this chapter" }).isVisible(), "the panel has the check buttons");
ok((await page.getByRole("button", { name: "Scan for codex changes" }).count()) === 0, "the old whole-entry scan is gone");

// ---- entry assist: new entry, undo, save ----
await page.getByRole("button", { name: "+ New entry" }).click();
const form = page.locator("form.ai-panel");
ok(!(await form.getByRole("button", { name: "Draft with AI" }).isEnabled()), "draft button needs a description");
await form.getByPlaceholder("Describe the entry").fill("a grizzled ferryman");
await form.getByRole("button", { name: "Draft with AI" }).click();
await form.getByRole("button", { name: "Undo AI change" }).waitFor();
ok((await form.getByLabel("Name", { exact: true }).inputValue()) === "Old Tam" && (await form.getByLabel(/Other names/).inputValue()) === "the ferryman", "AI filled the form");
await form.getByRole("button", { name: "Undo AI change" }).click();
ok((await form.getByLabel("Name", { exact: true }).inputValue()) === "", "undo restores the empty form");
await form.getByRole("button", { name: "Draft with AI" }).click();
await form.getByRole("button", { name: "Undo AI change" }).waitFor();
await form.getByRole("button", { name: "Add entry" }).click();
await page.locator("article.card", { hasText: "Old Tam" }).waitFor();
ok(true, "AI-drafted entry saved");

// ---- update an entry from the story (anchor suggested) ----
await page.locator("article.card", { hasText: "Gideon" }).getByRole("button", { name: "Edit" }).click();
await form.getByRole("button", { name: "Update from the story" }).click();
await form.getByRole("button", { name: "Undo AI change" }).waitFor();
ok((await form.getByLabel(/Description/).inputValue()) === "A smith who now keeps the inn.", "update filled the description");
ok(await form.getByText(/thinks this changed in “Start”/).isVisible(), "explains the suggested anchor");
const anchorValue = await form.locator("select").nth(1).inputValue();
ok(anchorValue === s1.root, "anchor select switched to the chapter the AI named");
const upd = calls.at(-1).user;
ok(upd.includes('Chapter 1: "Start"') && upd.includes('Chapter 2: "Horse"'), "update prompt lists the chapters since the entry's last change");
await form.getByRole("button", { name: "Save changes" }).click();
await page.locator("article.card", { hasText: "Old Tam" }).waitFor();
await page.goto(`${BASE}/c/${s1.root}/codex`);
await page.locator("article.card", { hasText: "Gideon" }).getByText("A smith who now keeps the inn.").first().waitFor();
ok(true, "the update took effect from the earlier chapter it was anchored at");

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
