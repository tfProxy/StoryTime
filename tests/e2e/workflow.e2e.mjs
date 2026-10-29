// The drafting page's workflow: revising a selected passage, comparing drafts, the save indicator,
// the end-of-branch notice, and posting without writing a summary first.
import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
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
    } else if (user.includes("[[START]]")) {
      text = "  REWRITTEN  ";
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

await page.goto(`${BASE}/c/${root}/write?choice=${choice.id}`);
const instruction = page.getByLabel("Instruction for the AI");
await instruction.waitFor();
ok(await instruction.isDisabled(), "the revise box is there but disabled until there is a chapter");

await page.getByLabel("Chapter title").fill("Door");
await page.getByLabel("Chapter text").fill("One. Two sentences here. Three.");
ok(await instruction.isEnabled(), "…and enabled once there is text");
ok(await page.getByText(/posting now ends this branch/).isVisible() && !/ends the branch/.test(await page.locator(".action-bar").innerText()), "no choices: the notice shows by the choices, not in the footer");
await page.getByPlaceholder("Choice 1").fill("Go in");
ok(!(await page.getByText(/posting now ends this branch/).isVisible()), "…and goes away with a choice");
await page.waitForFunction(() => /Draft saved/.test(document.body.innerText));
ok(true, "the page says when the draft was saved");

// revise just a selected passage, sent with the Enter key
const select = (from, to) =>
  page.locator("textarea[maxlength='50000']").evaluate((el, [a, b]) => {
    el.focus();
    el.setSelectionRange(a, b);
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }, [from, to]);
await select(5, 24); // "Two sentences here."
await page.getByRole("button", { name: "Revise selection" }).waitFor();
ok(true, "selecting text turns Revise into Revise selection");
await instruction.fill("tighter");
await instruction.press("Enter");
await page.getByRole("button", { name: "Edit text" }).waitFor();
const asked = prompts.at(-1);
ok(asked.system.includes("one marked passage") && asked.user.includes("One. [[START]]Two sentences here.[[END]] Three.") && asked.user.includes("tighter"), "only the selected passage goes to the AI as the one to change");
await page.getByRole("button", { name: "Edit text" }).click();
ok((await page.getByLabel("Chapter text").inputValue()) === "One. REWRITTEN Three.", "the reply replaces just that passage");
ok((await page.getByLabel("Chapter title").inputValue()) === "Door", "the title is untouched");

// post without writing a summary: one is made
const before = prompts.length;
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
const id = /\/c\/([^/?]+)/.exec(page.url())[1];
const c = (await get(`/api/chapters/${id}`)).chapter;
ok(c.title === "Door" && c.summary === "SUM(Door)" && prompts.slice(before).some((p) => p.system.includes("running summary")), "posting with no summary writes one");

// suggesting choices after writing is a setting, off by default
const settingsNow = (await get("/api/settings")).settings;
const withSetting = (on) => ({
  ...(settingsNow ?? { connections: [{ id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } }),
  autoSuggestChoices: on,
});
const put = (body) => fetch(BASE + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const newSlot = async (title) => {
  const st = await post("/api/stories", { title, premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Open the door"] } });
  return `/c/${st.chapter_id}/write?choice=${(await get(`/api/chapters/${st.chapter_id}`)).choices[0].id}`;
};
const suggestCalls = () => prompts.filter((p) => p.user.includes("distinct options the reader could pick")).length;

await put(withSetting(false));
await page.goto(BASE + (await newSlot("Suggest off")));
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
await page.waitForTimeout(500);
ok(suggestCalls() === 0 && (await page.locator("button.chip").count()) === 0, "off by default: no choices are suggested after writing");

await put(withSetting(true));
const callsBefore = suggestCalls();
await page.goto(BASE + (await newSlot("Suggest on")));
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "+ Go left" }).waitFor();
ok(suggestCalls() === callsBefore + 1 && (await page.locator("button.chip").count()) === 3, "on: choices are suggested once the chapter is written");
await page.getByRole("button", { name: "+ Go left" }).click();
ok((await page.getByPlaceholder("Choice 1").inputValue()) === "Go left", "a suggestion can be added with one click");

await put(settingsNow ? withSetting(settingsNow.autoSuggestChoices) : withSetting(false));

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
