// Writing a new chapter on the writing desk: the save indicator, posting without writing a summary first (the
// summary is written after), and the "Suggest choices after writing" setting; then Suggest choices on the reading page.
import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  // Which models Ollama has loaded (asked before a summary or suggestions): none.
  if (req.url?.endsWith("/api/ps")) { res.setHeader("content-type", "application/json"); return res.end('{"models":[]}'); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    prompts.push({ system, user });
    let text = "# Generated\n\nGenerated text here.";
    if (system.includes("running summary")) {
      const title = /Chapter: "([^"]*)"/.exec(user)?.[1];
      text = JSON.stringify({ summary: `SUM(${title})`, story_so_far: `SOFAR(${title})` });
    } else if (user.includes("distinct options the reader could pick")) {
      text = JSON.stringify(["Go left", "Go right", "Hide"]);
    }
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();

const story = await post("/api/stories", { title: "Workflow", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Open the door"] } });
const root = story.chapter_id;
const choice = (await get(`/api/chapters/${root}`)).choices[0];

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

const until = async (fn) => { for (let i = 0; i < 150; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

await page.goto(`${BASE}/c/${root}/desk?choice=${choice.id}`);
await page.getByLabel("Chapter title").waitFor();
await page.getByLabel("Chapter title").fill("Door");
await page.getByLabel("Chapter text").fill("One. Two sentences here. Three.");
ok(await page.getByLabel("Instruction for the AI").count() === 0 && await page.getByRole("button", { name: /^Revise|^Undo$/ }).count() === 0, "a hand-written chapter has no Revise box or Undo");
await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
ok(true, "the desk says when the draft was saved");

// post without writing a summary: one is written after, in the background
const before = prompts.length;
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1/);
const id = /\/c\/([^/?]+)/.exec(page.url())[1];
const c = await until(async () => { const ch = (await get(`/api/chapters/${id}`)).chapter; return ch.summary && ch; });
ok(c && c.title === "Door" && c.summary === "SUM(Door)" && prompts.slice(before).some((p) => p.system.includes("running summary")), "posting with no summary has one written");

// A Generate makes no choice suggestions (choices are suggested on demand, after posting), even with the switch
// "Suggest choices after writing" left on in settings saved before it was dropped.
const settingsNow = (await get("/api/settings")).settings;
const put = (body) => fetch(BASE + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const newSlot = async (title) => {
  const st = await post("/api/stories", { title, premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Open the door"] } });
  const slot = (await get(`/api/chapters/${st.chapter_id}`)).choices[0].id;
  return { href: `/c/${st.chapter_id}/desk?choice=${slot}`, key: `fill:${slot}` };
};
const suggestCalls = () => prompts.filter((p) => p.user.includes("distinct options the reader could pick")).length;
const draftOf = async (key) => (await get(`/api/drafts/${encodeURIComponent(key)}`)).draft;
const generateOn = async (slot) => {
  await page.goto(BASE + slot.href);
  await page.locator(".desk-gen-row").getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Edit text" }).waitFor();
  return until(async () => (await draftOf(slot.key))?.body?.includes("Generated text here.") && draftOf(slot.key));
};

if (settingsNow) await put({ ...settingsNow, autoSuggestChoices: true });
const callsBefore = suggestCalls();
const genSlot = await newSlot("No suggestions");
const genDraft = await generateOn(genSlot);
await page.waitForTimeout(500);
ok(genDraft && suggestCalls() === callsBefore && !genDraft.suggestions?.length, "no choices are suggested after writing");
await fetch(`${BASE}/api/drafts/${encodeURIComponent(genSlot.key)}`, { method: "DELETE" });

// ---- the reading page suggests choices too, and adds the ones picked ----
{
  const st = await post("/api/stories", { title: "Suggest on reading", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Open the door"] } });
  await page.goto(`${BASE}/c/${st.chapter_id}`);
  const before = suggestCalls();
  await page.getByRole("button", { name: "Suggest choices" }).click();
  await page.getByRole("button", { name: "+ Go left" }).waitFor();
  const sent = prompts.filter((p) => p.user.includes("distinct options the reader could pick")).at(-1).user;
  ok(suggestCalls() === before + 1 && sent.includes("# Root\n\nMira stood there.") && sent.includes('- "Open the door"'), "reading page: Suggest choices asks about this chapter, naming the choices it has");
  ok((await page.locator("button.chip").count()) === 3, "reading page: the suggestions are listed");
  await page.getByRole("button", { name: "+ Go left" }).click();
  await page.locator("a.choice-unwritten", { hasText: "Go left" }).waitFor();
  ok((await get(`/api/chapters/${st.chapter_id}`)).choices.map((c) => c.label).join() === "Open the door,Go left", "reading page: a picked suggestion becomes an unwritten choice");
  ok((await page.getByRole("button", { name: "+ Go left" }).count()) === 0, "…and leaves the list");
  await page.getByRole("button", { name: "Suggest choices" }).click();
  for (let i = 0; i < 50 && suggestCalls() < before + 2; i++) await page.waitForTimeout(100);
  const again = prompts.filter((p) => p.user.includes("distinct options the reader could pick")).at(-1).user;
  ok(again.includes('- "Go left"') && /not picked[^]*- "Go right"/.test(again), "reading page: suggesting again names the new choice and the ones not picked");
}

await browser.close();
mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
