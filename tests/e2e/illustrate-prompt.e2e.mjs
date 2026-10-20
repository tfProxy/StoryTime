// Picture prompts on the illustrate page: which codex entries are used, the story's art style and the prompt
// style being saved, and a prompt written by the (fake) model with the art style added, ready to copy.
import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();

// ---- a fake model whose reply the test chooses ----
const calls = [];
let reply = "";
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    if (!body.messages) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [] })); }
    calls.push({ system: body.messages[0].content, user: body.messages.at(-1).content, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

// ---- a story whose second chapter mentions Jim (in the codex) but not Zed ----
const created = await post("/api/stories", { title: "Sandwich saga", premise: "A kitchen comedy.", chapter: { title: "Hunger", body: "Jim stood in the kitchen.", choices: ["Make lunch"] } });
const choice = (await get(`/api/chapters/${created.chapter_id}`)).choices[0];
const chapter = (await post("/api/chapters", { choice_id: choice.id, title: "Lunch", body: "Jim made a sandwich in the kitchen. He took a big bite.", choices: [] })).chapter_id;
await post("/api/codex", { anchor_chapter_id: created.chapter_id, op: "create", name: "Jim", type: "character", content: "A tall man with blonde hair and a green apron." });
await post("/api/codex", { anchor_chapter_id: created.chapter_id, op: "create", name: "Zed", type: "character", content: "A one-eyed pirate captain." });
const storyId = created.story_id;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const ai = await useMockAi(BASE, { favorites: [{ connectionId: "t", model: "artist", label: "Artist" }], imagePromptModel: null });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const settingsNow = async () => (await get("/api/settings")).settings;
const until = async (fn, what) => {
  for (let i = 0; i < 40; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

try {
  await page.goto(`${BASE}/c/${chapter}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();

  // ---- the codex entries that would be used ----
  const used = page.getByText(/^Codex entries used:|^No codex entries/);
  ok((await used.innerText()) === "Codex entries used: Jim", "the codex entry the chapter mentions is listed, the other is not");
  const direction = page.getByLabel("What to show (optional)");
  await direction.fill("Zed bursts in");
  ok((await used.innerText()) === "Codex entries used: Jim, Zed", "…and an entry named in what to show is added");
  await direction.fill("");
  ok((await used.innerText()) === "Codex entries used: Jim", "…and dropped again when it is removed");
  ok(await page.getByRole("button", { name: "Write prompt", exact: true }).isVisible() && await page.getByRole("button", { name: "View prompt" }).isVisible(), "the page offers Write prompt and the eye button");

  // ---- the Prompt and Negative prompt fields are there from the start, so you can type your own ----
  const typedPrompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  const typedNegative = page.getByRole("textbox", { name: "Negative prompt", exact: true });
  ok(await typedPrompt.isVisible() && await typedNegative.isVisible(), "the Prompt and Negative prompt fields are shown before anything is written");
  ok((await typedPrompt.inputValue()) === "" && (await typedNegative.inputValue()) === "", "…and are empty");
  ok(await page.getByText(/^Scene:/).count() === 0, "…with no scene yet");
  ok(await page.getByRole("button", { name: "Copy prompt", exact: true }).isDisabled() && await page.getByRole("button", { name: "Copy negative" }).isDisabled(), "…and the copy buttons are off while they are empty");
  await typedPrompt.fill("my own prompt");
  ok(await page.getByRole("button", { name: "Copy prompt", exact: true }).isEnabled(), "typing a prompt turns Copy prompt on");
  ok(await page.getByRole("button", { name: "Write prompt", exact: true }).isVisible(), "…and the button still says Write prompt, since none was written");

  // ---- the story's art style is saved when the field loses focus ----
  const art = page.getByLabel("Art style for this story");
  ok((await art.inputValue()) === "" && (await get(`/api/stories/${storyId}`)).art_style === "", "a new story has no art style");
  await art.fill("watercolor storybook, soft light");
  ok((await get(`/api/stories/${storyId}`)).art_style === "", "typing alone doesn't save it");
  await art.blur();
  await page.getByText("Art style saved.").waitFor();
  ok((await get(`/api/stories/${storyId}`)).art_style === "watercolor storybook, soft light", "leaving the field saves the art style on the story");
  await page.reload();
  ok((await page.getByLabel("Art style for this story").inputValue()) === "watercolor storybook, soft light", "…and it is there when the page is opened again");

  // ---- the prompt style is a setting on the server ----
  const promptStyle = page.getByLabel("Prompt style");
  const before = (await settingsNow()).imagePromptStyle;
  ok(before === "tags" && (await promptStyle.inputValue()) === "tags", "picture prompts are written as tags by default");
  await promptStyle.selectOption({ label: "Sentences (Flux, SD3)" });
  ok(await until(async () => (await settingsNow()).imagePromptStyle === "natural", "the setting to be saved"), "choosing Sentences saves imagePromptStyle \"natural\" on the server");

  // ---- write a prompt for the chapter's end ----
  ok(await page.getByText(/^For$/).count() === 0 && await page.getByRole("option", { name: "Footer picture" }).count() === 0, "there is no For header/footer choice");
  const moment = page.getByLabel("Moment to show");
  ok((await moment.inputValue()) === "start" && (await moment.locator("option").allInnerTexts()).join("|") === "Chapter start|Chapter end", "the moment menu offers Chapter start and Chapter end, starting on Chapter start");
  const writeRow = await page.getByRole("button", { name: "Write prompt", exact: true }).evaluate((b) => b.parentElement === document.querySelector('[aria-label="Moment to show"]').parentElement);
  ok(writeRow, "…and sits beside the Write prompt button");
  await moment.selectOption({ label: "Chapter end" });
  await direction.fill("Jim taking the first bite [close-up]");
  reply = 'Here you go:\n```json\n{"scene":"Jim eats.","prompt":"a man with blonde hair eating a sandwich in a kitchen","negative":"text, watermark"}\n```';
  const callsBefore = calls.length;
  await page.getByRole("button", { name: "Write prompt", exact: true }).click();
  await page.getByText("Scene: Jim eats.").waitFor();
  ok(calls.length === callsBefore + 1, "one request was sent to the model");
  const sent = calls.at(-1);
  ok(sent.model === "cheap", "…to the cheaper model");
  ok(sent.user.includes("Jim made a sandwich in the kitchen. He took a big bite.") && sent.user.includes('"Lunch"'), "…with the chapter");
  ok(sent.user.includes("Jim [character]: A tall man with blonde hair and a green apron.") && !sent.user.includes("Zed"), "…and the codex entry it mentions, not the other");
  ok(sent.user.includes("The author wants the picture to show: Jim taking the first bite\n") && sent.user.includes("- close-up"), "…and what to show, with the [note] as an instruction");
  ok(sent.user.includes("closing moment") && !sent.user.includes("set the scene"), "…and the chapter end task");
  ok(sent.system.includes("plain descriptive English") && !sent.system.includes("comma-separated tags (Stable"), "…written for the sentence style");
  ok(sent.user.includes("Earlier in the story") === false, "…the previous chapter has no summary, so none is sent");
  // (a textarea inside its label gets a name that includes its own text, so find them by position: prompt, then negative)
  const promptBox = page.locator(".image-prompt-result textarea").nth(0);
  const negativeBox = page.locator(".image-prompt-result textarea").nth(1);
  ok((await page.locator(".image-prompt-result label").nth(0).innerText()).startsWith("Prompt") && (await page.locator(".image-prompt-result label").nth(1).innerText()).startsWith("Negative prompt"), "the result has a Prompt and a Negative prompt field");
  ok((await promptBox.inputValue()) === "a man with blonde hair eating a sandwich in a kitchen. watercolor storybook, soft light.", "the prompt has the art style added as a sentence (replacing what was typed before)");
  ok((await negativeBox.inputValue()) === "text, watermark", "the negative prompt is shown");
  ok(await page.getByText("Scene: Jim eats.").isVisible() && await page.getByRole("button", { name: "Write again" }).isVisible(), "the scene is shown and the button now says Write again");
  ok((await get(`/api/stories/${storyId}`)).art_style === "watercolor storybook, soft light", "the art style on the story is unchanged");

  // ---- copying ----
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await page.getByText("Prompt copied.").waitFor();
  ok((await page.evaluate(() => navigator.clipboard.readText())) === "a man with blonde hair eating a sandwich in a kitchen. watercolor storybook, soft light.", "Copy prompt puts the prompt on the clipboard");
  await page.getByRole("button", { name: "Copy negative" }).click();
  await page.getByText("Negative prompt copied.").waitFor();
  ok((await page.evaluate(() => navigator.clipboard.readText())) === "text, watermark", "Copy negative puts the negative prompt on the clipboard");

  // ---- the author can edit it ----
  await promptBox.fill("edited by hand");
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  ok((await page.evaluate(() => navigator.clipboard.readText())) === "edited by hand", "an edited prompt is what gets copied");

  // ---- back to tags, written again for the chapter's start ----
  await promptStyle.selectOption({ label: "Tags (SDXL, Pony, SD 1.5)" });
  ok(await until(async () => (await settingsNow()).imagePromptStyle === "tags", "the setting to be saved"), "switching back saves imagePromptStyle \"tags\"");
  await moment.selectOption({ label: "Chapter start" });
  await direction.fill("");
  await page.getByRole("button", { name: "Write again" }).click();
  await page.waitForFunction(() => document.querySelector(".image-prompt-result textarea")?.value.endsWith(", watercolor storybook, soft light"));
  const again = calls.at(-1);
  ok(again.system.includes("comma-separated tags") && again.user.includes("set the scene") && !again.user.includes("closing moment") && !again.user.includes("The author wants"), "writing again uses the tag style, the chapter start task and no direction");
  ok((await promptBox.inputValue()) === "a man with blonde hair eating a sandwich in a kitchen, watercolor storybook, soft light", "the art style is added as another tag");

  // ---- an art style changed just before writing is saved and used ----
  await art.fill("pencil sketch");
  await page.getByRole("button", { name: "Write again" }).click();
  await page.waitForFunction(() => document.querySelector(".image-prompt-result textarea")?.value.endsWith(", pencil sketch"));
  ok((await get(`/api/stories/${storyId}`)).art_style === "pencil sketch", "writing saves a changed art style first");

  // ---- the eye button shows what would be sent ----
  await direction.fill("Jim at the table");
  await page.getByRole("button", { name: "View prompt" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const shown = await dialog.innerText();
  ok(shown.includes("Prompt: Write prompt") && shown.includes("The author wants the picture to show: Jim at the table") && shown.includes("Jim [character]"), "the eye button shows the prompt as it would be sent now");
  await page.keyboard.press("Escape");

  // ---- bad replies ----
  const bad = async (text, pattern, what) => {
    reply = text;
    await page.getByRole("button", { name: "Write again" }).click();
    await page.getByText(pattern).waitFor();
    ok(true, what);
  };
  await bad("Sorry, I can't draw.", /didn't return anything I could read/, "a reply that isn't JSON shows an error");
  await bad('{"scene":"x","prompt":""}', /no prompt in it/, "a reply with no prompt shows an error");
  ok((await promptBox.inputValue()).endsWith("pencil sketch"), "…and the earlier prompt is kept");

  // ---- the model for picture prompts is a setting, shared by every chapter's page ----
  const picker = page.getByLabel("Model for picture prompts");
  ok((await picker.locator("option:checked").innerText()).startsWith("Default"), "the model starts on the default");
  await picker.selectOption({ label: "Artist" });
  ok(await until(async () => (await settingsNow()).imagePromptModel?.model === "artist", "the model to be saved"), "choosing a model saves imagePromptModel on the server");
  reply = '{"scene":"s","prompt":"p","negative":""}';
  await page.getByRole("button", { name: "Write again" }).click();
  await page.getByText("Scene: s", { exact: true }).waitFor();
  ok(calls.at(-1).model === "artist", "…and prompts are written with it");
  await page.goto(`${BASE}/c/${created.chapter_id}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Model for picture prompts"] option:checked')?.textContent === "Artist");
  ok(true, "another chapter's Illustrate page has the same model chosen");
  await page.getByLabel("Model for picture prompts").selectOption({ index: 0 });
  ok(await until(async () => (await settingsNow()).imagePromptModel === null, "the default to be saved"), "going back to the default saves null");
} finally {
  // leave the server's settings as they were
  await ai.restore();
  await browser.close();
  mock.close();
}
ok((await settingsNow())?.imagePromptStyle !== "natural", "the prompt style is not left on sentences");
process.exit(failed ? 1 : 0);
