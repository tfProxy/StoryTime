// The eye button beside each AI button opens a floating window with the prompt it would send,
// and a button there copies the prompt.
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
    const body = JSON.parse(data || "{}");
    prompts.push({ system: body.messages[0].content, user: body.messages.at(-1).content });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "# Generated\n\nGenerated text here." } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

const settingsBefore = (await json("GET", "/api/settings")).settings;
await json("PUT", "/api/settings", { ...(settingsBefore ?? {}), autoSuggestChoices: false, connections: [{ id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } });

const browser = await launch();
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const dialog = page.getByRole("dialog");
const viewPrompt = (name) => page.getByTitle(`View the prompt: ${name}`, { exact: true });

await page.goto(`${BASE}/new`);
await page.getByLabel("Story title").fill("Prompt tale");
await page.getByLabel("Premise").fill("A lighthouse keeper.");
await page.getByLabel(/^What should happen/).fill("a storm arrives [keep it short]");

// ---- the Generate button's prompt ----
await viewPrompt("Generate chapter").click();
await dialog.waitFor();
const text = await dialog.innerText();
ok(text.includes("System") && text.includes("Output format") && text.includes("Message"), "the window shows the system prompt and the message");
ok(text.includes("Premise: A lighthouse keeper.") && text.includes("Direction from the author: a storm arrives") && text.includes("- keep it short"), "…with what is typed in the form");
ok(prompts.length === 0, "viewing a prompt sends nothing");

// ---- copying ----
await dialog.getByRole("button", { name: "Copy prompt" }).click();
await dialog.getByText("Copied to the clipboard.").waitFor();
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok(clip.includes("Output format") && clip.includes("Direction from the author: a storm arrives") && clip.indexOf("Output format") < clip.indexOf("Premise:"), "the copy holds the system prompt, then the message");

// ---- closing: Escape, the button, and clicking outside ----
await page.keyboard.press("Escape");
await dialog.waitFor({ state: "hidden" });
ok(await viewPrompt("Generate chapter").evaluate((el) => el === document.activeElement), "Escape closes it and focus goes back to the eye button");
await viewPrompt("Generate chapter").click();
await dialog.getByRole("button", { name: "Close" }).click();
await dialog.waitFor({ state: "hidden" });
await viewPrompt("Generate chapter").click();
await page.mouse.click(5, 5);
await dialog.waitFor({ state: "hidden" });
ok(true, "the Close button and a click outside close it too");

// ---- a long prompt scrolls inside the window instead of running off the screen ----
await page.getByLabel(/^What should happen/).fill("Long direction. ".repeat(600));
await viewPrompt("Generate chapter").click();
const box = await dialog.boundingBox();
const body = dialog.locator(".prompt-window-body");
const [scrollable, viewport] = await Promise.all([
  body.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto"),
  page.evaluate(() => window.innerHeight),
]);
ok(box.y >= 0 && box.y + box.height <= viewport && scrollable, "a long prompt stays inside the window, which scrolls");
await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
ok((await body.evaluate((el) => el.scrollTop)) > 0 && (await dialog.getByRole("button", { name: "Close" }).isVisible()), "…and can be scrolled to the end with the buttons still in view");
await page.keyboard.press("Escape");
await page.getByLabel(/^What should happen/).fill("the lamp goes out");

// ---- the prompt follows the form, and matches what is sent ----
await page.getByLabel(/^What should happen/).fill("the lamp goes out");
await viewPrompt("Generate chapter").click();
const shown = (await dialog.locator("pre").nth(1).innerText()).trim();
ok(shown.includes("the lamp goes out") && !shown.includes("a storm arrives"), "a later view shows the current form");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Generate chapter", exact: true }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok(prompts.at(-1).user.trim() === shown, "…and it is the message that Generate then sends");

// ---- other buttons ----
ok(await viewPrompt("Revise").isEnabled(), "the Revise prompt can be viewed once there is a chapter");
await page.locator("summary", { hasText: "Brainstorm" }).click(); // folded away once there is a chapter
await viewPrompt("Suggest ideas").click();
ok((await dialog.innerText()).includes("Reply with only a JSON array of 4 objects"), "Suggest ideas shows its prompt");
await page.keyboard.press("Escape");
await viewPrompt("Summarize chapter").click();
ok((await dialog.innerText()).includes("Generated text here.") && (await dialog.innerText()).includes("cheaper"), "Summarize chapter shows its prompt, with a note about the model");
await page.keyboard.press("Escape");
await viewPrompt("Suggest choices").click();
ok((await dialog.innerText()).includes("Suggest 3 distinct options"), "Suggest choices shows its prompt");
await page.keyboard.press("Escape");

// ---- the settings page ----
await page.goto(`${BASE}/settings`);
await viewPrompt("Try a sample reply").click();
ok((await dialog.innerText()).includes("Write one sentence that opens a fantasy adventure story."), "the settings page shows the sample prompt");

await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close(); mock.close();
process.exit(failed ? 1 : 0);
