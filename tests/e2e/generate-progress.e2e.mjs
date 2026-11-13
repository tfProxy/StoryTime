// A Generate on the writing desk says what it is doing (waiting for the model, thinking, writing) and shows the
// model's thinking in a fold, kept out of the chapter: thinking sent as `reasoning_content`, and as a <think> block.
// The reading page's Suggest choices (an AI call from the browser) shows its step and thinking too.
import http from "node:http";
import { launch, startStory, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.SHOTS_DIR;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// How the next chapter reply comes: "field" sends the reasoning as its own field, "tag" inside a <think> block.
let style = "field";
let slowChoices = false;
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", async () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages?.[0]?.content ?? "";
    res.setHeader("content-type", "text/event-stream");
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    if (system.includes("Output format")) {
      // A slow start (the model loading), some thinking, then the chapter.
      await wait(1500);
      const thoughts = ["Let me think about ", "the cellar scene. ", "THOUGHT-MARK: keep it short."];
      for (const t of thoughts) {
        send(style === "field" ? { reasoning_content: t } : { content: t === thoughts[0] ? `<think>${t}` : t });
        await wait(500);
      }
      if (style === "tag") send({ content: "</think>\n\n" });
      await wait(800);
      send({ content: "# The Cellar\n\nShe went down " });
      await wait(400);
      send({ content: "the steps." });
    } else if (system.includes("button text and nothing else")) {
      send({ content: "Go down" });
    } else {
      // Suggested choices: slow and thinking first when a test asks (the Suggest choices button, made from the page).
      if (slowChoices) {
        await wait(800);
        send({ reasoning_content: "CHOICE-THOUGHT: two ways on." });
        await wait(1500);
      }
      send({ content: '["Left", "Right"]' });
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const until = async (fn, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    if (await fn().catch(() => false)) return true;
    await wait(100);
  }
  return false;
};

const ai = await useMockAi(BASE);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1100 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
let storyId = null;

try {
  storyId = await startStory(page, BASE, { title: "Progress tale" });
  const genButton = page.locator(".desk-gen-row").getByRole("button", { name: /^Generate/ });
  await genButton.click();
  // The Generate's step line, under its button (the other buttons' step lines are inside .ai-call-progress).
  const step = page.locator(".desk-prompt > .generate-step");
  ok(await until(() => step.getByText("Waiting for the model…").isVisible()), "before the first word, the page says it is waiting for the model");
  const activity = page.locator(".site-header .header-activity-line");
  ok(await until(async () => /Writing “.*” · (Waiting for the model…|The model is thinking…)/.test((await activity.textContent()) ?? "")), "the header's line says what the Generate is doing");
  // The header stays at the top of the window while the page scrolls (a shorter window, so this early page scrolls).
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.mouse.wheel(0, 1500);
  ok(await until(async () => (await page.evaluate(() => window.scrollY)) > 100 && Math.abs((await page.locator(".site-header").boundingBox()).y) < 1), "the header stays in view when the page scrolls");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/header-activity-desktop.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1000, height: 1100 });
  ok(await until(() => step.getByText("The model is thinking…").isVisible()), "…then that the model is thinking");
  const fold = page.locator(".thinking-fold");
  ok(await until(() => fold.isVisible()), "the thinking gets a fold");
  await fold.locator("summary").click();
  ok(await until(async () => (await fold.locator(".thinking-text").textContent())?.includes("THOUGHT-MARK")), "the fold shows the thinking as it comes");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/generate-thinking-desktop.png` });
  ok(await until(() => step.getByText("Writing the chapter…").isVisible(), 50), "…then that it is writing the chapter");
  await page.getByRole("button", { name: "Edit text" }).waitFor({ timeout: 15000 });
  ok(await until(async () => (await page.getByRole("button", { name: "Generate again" }).isEnabled())), "the Generate ends");
  const text = await page.locator("#field-body").textContent();
  ok(text.includes("She went down the steps.") && !text.includes("THOUGHT-MARK"), "the chapter has the text and not the thinking");
  ok(await fold.locator("summary").textContent().then((s) => s.startsWith("What the model thought")), "after it ends, the fold is kept, as what the model thought");
  ok((await step.count()) === 0, "the step line goes when it ends");
  ok(await until(() => page.locator(".header-activity").isHidden()), "the header's line goes when nothing is going");

  // A server that leaves the thinking in the reply, as a <think> block.
  style = "tag";
  await page.setViewportSize({ width: 400, height: 900 });
  await page.getByRole("button", { name: "Generate again" }).click();
  ok(await until(() => step.getByText("The model is thinking…").isVisible()), "a <think> block also shows as thinking");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/generate-thinking-400.png` });
  ok(await until(async () => (await page.getByRole("button", { name: "Generate again" }).isEnabled()), 150), "the second Generate ends");
  const second = await page.locator("#field-body").textContent();
  ok(second.includes("She went down the steps.") && !second.includes("THOUGHT-MARK") && !second.includes("think>"), "the <think> block is kept out of the chapter");
  ok((await page.locator(".thinking-fold .thinking-text").textContent()).includes("THOUGHT-MARK"), "…and shown in the fold");

  // A button that calls the AI from the page (the reading page's Suggest choices) shows its step and thinking too,
  // and so does the header.
  await page.setViewportSize({ width: 1000, height: 1100 });
  const posted = await (await fetch(`${BASE}/api/stories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Progress choices", chapter: { title: "Start", body: "It began." } }) })).json();
  await page.goto(`${BASE}/c/${posted.chapter_id}`);
  slowChoices = true;
  await page.getByRole("button", { name: "Suggest choices" }).click();
  const callProgress = page.locator(".ai-call-progress");
  ok(await until(() => callProgress.getByText("The model is thinking…").isVisible()), "Suggest choices says the model is thinking");
  ok(await until(async () => ((await activity.textContent()) ?? "").startsWith("Suggest choices · The model is thinking…")), "…and so does the header");
  await callProgress.locator(".thinking-fold summary").click();
  ok(await until(async () => ((await callProgress.locator(".thinking-text").textContent()) ?? "").includes("CHOICE-THOUGHT")), "…with its thinking in a fold");
  ok(await until(() => page.getByRole("button", { name: "+ Left" }).isVisible()), "the suggestions come");
  ok(await until(() => callProgress.isHidden()), "…and the step line goes");
  slowChoices = false;
} finally {
  if (storyId) {
    await fetch(`${BASE}/api/drafts/${encodeURIComponent(`first:${storyId}`)}`, { method: "DELETE" }).catch(() => {});
    await fetch(`${BASE}/api/stories/${storyId}`, { method: "DELETE" }).catch(() => {});
  }
  await ai.restore();
  await browser.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
