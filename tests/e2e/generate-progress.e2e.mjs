// A Generate on the drafting page says what it is doing (waiting for the model, thinking, writing) and shows the
// model's thinking in a fold, kept out of the chapter: thinking sent as `reasoning_content`, and as a <think> block.
import http from "node:http";
import { launch, startStory, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOTS = process.env.SHOTS_DIR;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// How the next chapter reply comes: "field" sends the reasoning as its own field, "tag" inside a <think> block.
let style = "field";
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
    } else {
      send({ content: system.includes("button text and nothing else") ? "Go down" : '["Left", "Right"]' });
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
  await page.getByRole("button", { name: "Generate chapter" }).click();
  ok(await until(() => page.getByText("Waiting for the model…").isVisible()), "before the first word, the page says it is waiting for the model");
  ok(await until(() => page.getByText("The model is thinking…").isVisible()), "…then that the model is thinking");
  const fold = page.locator(".thinking-fold");
  ok(await until(() => fold.isVisible()), "the thinking gets a fold");
  await fold.locator("summary").click();
  ok(await until(async () => (await fold.locator(".thinking-text").textContent())?.includes("THOUGHT-MARK")), "the fold shows the thinking as it comes");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/generate-thinking-desktop.png` });
  ok(await until(() => page.getByText("Writing the chapter…").isVisible(), 50), "…then that it is writing the chapter");
  await page.getByRole("button", { name: "Edit text" }).waitFor({ timeout: 15000 });
  ok(await until(async () => (await page.getByRole("button", { name: "Generate a new draft" }).isEnabled())), "the Generate ends");
  const text = await page.locator("#field-body").textContent();
  ok(text.includes("She went down the steps.") && !text.includes("THOUGHT-MARK"), "the chapter has the text and not the thinking");
  ok(await fold.locator("summary").textContent().then((s) => s.startsWith("What the model thought")), "after it ends, the fold is kept, as what the model thought");
  ok((await page.getByText("Writing the chapter…").count()) === 0, "the step line goes when it ends");

  // A server that leaves the thinking in the reply, as a <think> block.
  style = "tag";
  await page.setViewportSize({ width: 400, height: 900 });
  await page.getByRole("button", { name: "Generate a new draft" }).click();
  ok(await until(() => page.getByText("The model is thinking…").isVisible()), "a <think> block also shows as thinking");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/generate-thinking-400.png` });
  ok(await until(async () => (await page.getByRole("button", { name: "Generate a new draft" }).isEnabled()), 150), "the second Generate ends");
  const second = await page.locator("#field-body").textContent();
  ok(second.includes("She went down the steps.") && !second.includes("THOUGHT-MARK") && !second.includes("think>"), "the <think> block is kept out of the chapter");
  ok((await page.locator(".thinking-fold .thinking-text").textContent()).includes("THOUGHT-MARK"), "…and shown in the fold");
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
