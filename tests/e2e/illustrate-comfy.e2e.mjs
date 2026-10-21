// Making chapter pictures with ComfyUI from the browser, against a fake ComfyUI (tests/e2e/fakeComfy.mjs):
// the Settings section (address, connection test, CORS hint, workflow summary), then the Illustrate page
// (own prompt, checkpoint list, progress, candidates, using one as the header or footer picture, refused
// workflows, Stop, and the polling path when the WebSocket is refused).
import fs from "node:fs";
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3555;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const settingsNow = async () => (await get("/api/settings")).settings;
const until = async (fn, what, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a chapter to illustrate ----
const created = await post("/api/stories", { title: "Lighthouse tale", premise: "A keeper and a storm.", chapter: { title: "The lamp", body: "The keeper climbed the stairs to light the lamp.", choices: [] } });
const chapterId = created.chapter_id;
const storyId = created.story_id;

// Settings live on the server: remember what is there and put it back at the end.
const before = await settingsNow();
const baseComfy = { url: "", workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 };
await putSettings({ ...(before ?? {}), comfy: baseComfy });

const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 8, stepDelay: 250 });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
const negativeBox = page.getByRole("textbox", { name: "Negative prompt", exact: true });
const makeButton = page.getByRole("button", { name: "Queue", exact: true });
// Longer than the page waits for more clicks before sending a job (GATHER_MS).
const GATHER_WAIT = 1000;
// Two quick clicks: one job of two pictures.
const makeTwo = async () => {
  await makeButton.click();
  await makeButton.click();
};
const live = page.locator(".comfy-pending-tile [role=status]");
const items = page.locator(".candidates li.picture-tile");
// A job being made: its first place, which has its progress text and Stop. Newest first.
const rows = page.locator(".comfy-pending-tile:has([role=status])");
// Each run of pictures, newest first, described as "<prompt> · N pictures · N being made". The runs have
// no heading on the page: the prompt comes from the name of the run's list, the counts from its tiles.
const headTexts = () =>
  page.locator(".picture-group .candidates").evaluateAll((uls) =>
    uls.map((ul) => {
      const prompt = ul.getAttribute("aria-label").replace(/^Pictures from “/, "").replace(/”$/, "");
      const made = ul.querySelectorAll("li.picture-tile").length;
      const coming = ul.querySelectorAll("li.comfy-pending-tile").length;
      return [prompt, made && `${made} picture${made === 1 ? "" : "s"}`, coming && `${coming} being made`].filter(Boolean).join(" · ");
    }),
  );
// Use as header or footer is in a picture's ☰ menu.
const useAs = async (tile, slot) => {
  await tile.getByRole("button", { name: "More" }).click();
  await tile.getByRole("menuitem", { name: `Use as ${slot} picture` }).click();
};
const card = (title) => page.locator(".image-editor", { has: page.getByRole("heading", { name: title }) });
const promptCalls = (from = 0) => comfy.calls.slice(from).filter((c) => c.method === "POST" && c.path === "/prompt");
const picturesLoaded = (n) => page.waitForFunction((n) => {
  const imgs = [...document.querySelectorAll(".candidates img")];
  return imgs.length === n && imgs.every((i) => i.complete && i.naturalWidth > 0);
}, n);
const openIllustrate = async () => {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
};
const openSettings = async () => {
  await page.goto(`${BASE}/settings`);
  await page.locator("#pictures").waitFor();
  await page.waitForLoadState("networkidle");
};

try {
  // ---- no ComfyUI address yet ----
  await openIllustrate();
  await page.getByText("To make pictures here, add your ComfyUI machine in").waitFor();
  ok(await page.getByRole("link", { name: "Settings", exact: true }).getAttribute("href") === "/settings#pictures", "with no ComfyUI address, the page says to add it in Settings (linking to the Pictures section)");
  ok(await page.getByRole("heading", { name: "Make pictures" }).count() === 0 && await makeButton.count() === 0, "…and offers no Queue button");
  ok(await promptBox.isVisible() && await negativeBox.isVisible(), "…but the prompt fields are there, to type in and copy");

  // ---- Settings: the address, the connection test and the CORS hint ----
  await openSettings();
  const section = page.locator("#pictures");
  ok(await section.getByRole("heading", { name: "Pictures (ComfyUI)" }).isVisible(), "Settings has a Pictures (ComfyUI) section");
  ok(await section.getByRole("button", { name: "Test connection" }).isDisabled(), "Test connection is off until there is an address");
  ok(await section.locator("code", { hasText: `--enable-cors-header ${BASE}` }).isVisible(), "the CORS hint shows this page's own address");
  const address = section.getByLabel("ComfyUI address");

  await address.fill("http://localhost:1");
  await section.getByRole("button", { name: "Test connection" }).click();
  const unreachable = section.getByText(/Couldn't reach ComfyUI at http:\/\/localhost:1/);
  await unreachable.waitFor();
  ok((await unreachable.innerText()).includes(`--enable-cors-header ${BASE}`), "an address nothing answers on says it couldn't reach ComfyUI, and repeats the CORS flag to use");

  await address.fill(comfy.url);
  ok(await until(async () => (await settingsNow()).comfy.url === comfy.url, "the address to be saved"), "the address is saved on the server");
  await section.getByRole("button", { name: "Test connection" }).click();
  await section.getByText("Connected to ComfyUI 0.3.99. 2 checkpoints available.").waitFor();
  ok(true, "Test connection reports the version and the number of checkpoints");
  ok(comfy.calls.some((c) => c.path === "/system_stats") && comfy.calls.some((c) => c.path === "/models/checkpoints"), "…by asking /system_stats and /models/checkpoints");

  // ---- Settings: what the workflow box says ----
  const workflow = section.locator("textarea");
  const summaryText = async () => (await section.locator("label:has(textarea) + p").innerText());
  ok((await summaryText()).startsWith("Using the built-in SDXL workflow"), "an empty workflow box says the built-in SDXL workflow is used");

  await workflow.fill(JSON.stringify({ last_node_id: 3, nodes: [{ id: 1, type: "KSampler" }], links: [[1, 1, 0, 2, 0, "LATENT"]], version: 0.4 }));
  await section.locator("p.error", { hasText: "API format" }).waitFor();
  ok(true, "pasting ComfyUI's regular (UI) workflow file shows an error pointing to Export (API)");
  await workflow.fill("{ not json");
  await section.locator("p.error", { hasText: "isn't valid JSON" }).waitFor();
  ok(true, "text that isn't JSON shows an error");

  await workflow.fill(JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}, {{checkpoint}}" } }, "2": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: "{{count}}" } } }));
  await page.getByText(/^Placeholders found: StoryTime sets the prompt, checkpoint, size, how many\./).waitFor();
  ok((await summaryText()).includes("keeps its own negative prompt, seed"), "a placeholder workflow lists what it sets and what it keeps");
  ok(await until(async () => (await settingsNow()).comfy.workflow.includes("{{prompt}}"), "the workflow to be saved"), "…and the workflow is saved on the server");

  await workflow.fill(JSON.stringify({ "3": { class_type: "KSampler", inputs: { seed: 1, positive: ["6", 0], negative: ["7", 0] } }, "6": { class_type: "CLIPTextEncode", inputs: { text: "a" } }, "7": { class_type: "CLIPTextEncode", inputs: { text: "b" } } }));
  await page.getByText(/^Found automatically: StoryTime sets the prompt, negative prompt, seed\./).waitFor();
  ok(true, "a workflow without placeholders says what was found automatically");

  await workflow.fill(JSON.stringify({ "1": { class_type: "SaveImage", inputs: {} } }));
  await section.locator("p.error", { hasText: "nothing for the prompt" }).waitFor();
  ok(true, "a workflow with nowhere for the prompt is flagged");

  await workflow.fill("");
  await page.getByText(/^Using the built-in SDXL workflow/).waitFor();
  ok(await until(async () => (await settingsNow()).comfy.workflow === "", "the workflow to be cleared"), "clearing the box goes back to the built-in workflow");

  // ---- the Illustrate page with an address ----
  await openIllustrate();
  await page.getByRole("heading", { name: "Make pictures" }).waitFor();
  ok(await page.getByLabel("Checkpoint").count() === 0, "there is no Checkpoint menu on the Illustrate page: the checkpoint is the story's");
  ok((await page.locator(".story-pictures").innerText()).includes("no checkpoint") && await page.getByRole("link", { name: "Choose them in Story details" }).isVisible(), "a story with no checkpoint says so, with a link to its details page");
  ok(await makeButton.isDisabled(), "Make pictures is off while the prompt is empty");

  await promptBox.fill("a lighthouse at dawn, gulls");
  await negativeBox.fill("blurry, text");
  ok(await makeButton.isEnabled(), "typing your own prompt turns Make pictures on");

  await makeButton.click();
  await page.getByText("This story has no checkpoint chosen. Choose one in Story details.").waitFor();
  ok(promptCalls().length === 0, "making pictures with no checkpoint chosen says so, and sends nothing to ComfyUI");

  // ---- the checkpoint is chosen on the story's details page ----
  await page.getByRole("link", { name: "Choose them in Story details" }).click();
  await page.waitForURL(`**/s/${storyId}/details#pictures`);
  const checkpoint = page.locator("#pictures").getByLabel("Checkpoint");
  await checkpoint.locator("option", { hasText: "fake_sdxl_b.safetensors" }).waitFor({ state: "attached" });
  const options = await checkpoint.locator("option").allInnerTexts();
  ok(options.includes("fake_sdxl_a.safetensors") && options.includes("fake_sdxl_b.safetensors"), "its Checkpoint list shows the checkpoints from ComfyUI");
  await checkpoint.selectOption("fake_sdxl_b.safetensors");
  await page.getByRole("button", { name: "Save picture settings" }).click();
  await page.getByText("Picture settings saved.").waitFor();
  ok((await get(`/api/stories/${storyId}`)).checkpoint === "fake_sdxl_b.safetensors", "choosing a checkpoint there saves it with the story");
  await openIllustrate();
  await promptBox.fill("a lighthouse at dawn, gulls");
  await negativeBox.fill("blurry, text");
  ok((await page.locator(".story-pictures").innerText()).includes("fake_sdxl_b.safetensors"), "the Illustrate page shows the story's checkpoint");
  ok(await page.getByLabel("How many").count() === 0 && await page.getByText("One picture per click.").count() === 0, "there is no How many menu, and no line saying each click makes one picture");
  const queueStatus = page.getByLabel("Queue", { exact: true });
  ok((await makeButton.innerText()) === "Queue" && (await queueStatus.innerText()).trim() === "In progress: 0 · Queued: 0", "the button is just Queue, with the queue's status under it (nothing yet)");
  const [queueBox, dockBox] = [await makeButton.boundingBox(), await page.locator(".generate-bar").boundingBox()];
  ok(queueBox.width > dockBox.width - 40, "…the button takes the whole line");
  const sizeBox = await page.getByLabel("Size").boundingBox();
  ok(sizeBox.y + sizeBox.height <= queueBox.y + 1, "…with the Size menu just above it");

  // ---- quick clicks with nothing changed are one job ----
  const mark = comfy.calls.length;
  await makeButton.click();
  const gatherGroup = page.locator(".picture-group").first();
  ok(await until(async () => (await headTexts())[0] === "a lighthouse at dawn, gulls · 1 being made" && (await gatherGroup.innerText()).includes("Click again for more pictures in this job"), "the gathering job"), "a click shows a job of one picture, in a run of its prompt, that a moment more can still add to");
  await makeButton.click();
  ok(await until(async () => (await headTexts())[0].endsWith("2 being made"), "2 being made") && await rows.count() === 1, "…and a second quick click adds a picture to it rather than a job");
  ok(await gatherGroup.locator(".comfy-pending-tile").count() === 2, "…and a place for its picture straight away");
  await until(() => promptCalls(mark).length === 1, "the job to be sent");
  ok(Object.values(promptCalls(mark)[0].body.prompt).find((n) => n.class_type === "EmptyLatentImage").inputs.batch_size === 2, "…which goes to ComfyUI as one job of two pictures once the clicks stop");
  await live.filter({ hasText: /Step \d+ of 8/ }).waitFor();
  ok(true, "while ComfyUI works, the page shows its progress (Step X of 8)");
  ok(await makeButton.isEnabled() && await page.getByRole("button", { name: "Stop", exact: true }).isVisible(), "…the Queue button stays on, and the job has a Stop button");
  ok(/^In progress: 2 \(step \d+ of 8\) · Queued: 0$/.test((await queueStatus.innerText()).trim()), "…and the status under it counts the pictures in progress, with the step");
  ok((await headTexts())[0] === "a lighthouse at dawn, gulls · 2 being made", "…the job shows a place for each picture it makes");
  ok(await page.locator(".chapter-pictures .picture-group").first().locator(".candidates li").first().evaluate((li) => li.classList.contains("comfy-pending-tile")), "…in the picture grid at the top of the Pictures panel, where its pictures will arrive");
  ok(await page.locator('progress[aria-label="Progress"]').isVisible(), "…with a progress bar");
  const pending = page.locator(".comfy-pending-tile");
  const pendingBoxes = await pending.evaluateAll((ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
  ok(pendingBoxes.length === 2 && pendingBoxes.every((b) => Math.abs(b.w / b.h - 1344 / 768) < 0.02 && b.w > 300), "a place is kept for each of the job's two pictures, at their shape (1344 × 768)");
  ok(await pending.nth(1).locator("progress").isVisible() && await live.count() === 1, "…each with the job's progress over it (read out once)");
  await items.first().waitFor();
  await picturesLoaded(2);
  ok(await items.count() === 2, "two pictures appear");
  ok(await page.getByRole("list", { name: "Pictures from “a lighthouse at dawn, gulls”" }).isVisible() && await live.count() === 0, "…in a list named after their prompt, and the progress text is gone");
  const group = page.locator(".picture-group").first();
  const groupText = await group.innerText();
  ok(!groupText.includes("a lighthouse at dawn") && !groupText.includes("blurry") && !groupText.includes("Chapter start"), "…with no heading: the prompt, the moment and the negative prompt aren't shown above them");

  // ---- Info: everything a picture was made with ----
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const firstTile = items.first();
  await firstTile.getByRole("button", { name: "More" }).click();
  await firstTile.getByRole("menuitem", { name: "Info" }).click();
  const info = page.getByRole("dialog", { name: "Picture info" });
  await info.waitFor();
  const infoText = await info.innerText();
  const firstSeed = infoText.match(/Seed\D*(\d+)/)[1];
  ok(infoText.includes("a lighthouse at dawn, gulls") && infoText.includes("blurry, text"), "Info in the ☰ menu shows the prompt and the negative prompt");
  ok(["“The lamp”, chapter start", "fake_sdxl_b.safetensors", "1344 × 768", firstSeed, "picture 1 of 2 (batch size 2, batch index 0)", "(ComfyUI output)"].every((t) => infoText.includes(t)), `…the chapter and moment, checkpoint, size, seed, its place in the batch and its file (${infoText.replace(/\n/g, " | ")})`);
  await info.getByRole("button", { name: "Copy prompt" }).click();
  await info.getByText("Copied the prompt.").waitFor();
  ok(await page.evaluate(() => navigator.clipboard.readText()) === "a lighthouse at dawn, gulls", "Copy prompt copies the prompt");
  await info.getByRole("button", { name: "Copy all as Markdown" }).click();
  await info.getByText("Copied everything as Markdown.").waitFor();
  const md = await page.evaluate(() => navigator.clipboard.readText());
  ok(md.includes("## Prompt\n\n```\na lighthouse at dawn, gulls\n```") && md.includes("## Negative prompt\n\n```\nblurry, text\n```") && md.includes(`- **Seed:** ${firstSeed}`), "Copy all as Markdown copies the prompts in code blocks and the settings as a list");
  // Served over plain http (the NAS), there is no navigator.clipboard: the copy falls back to a hidden text box inside the popup.
  await page.evaluate(() => {
    const read = navigator.clipboard.readText.bind(navigator.clipboard);
    window.__readClipboard = read;
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined, configurable: true });
  });
  await info.getByRole("button", { name: "Copy negative prompt" }).click();
  await info.getByText("Copied the negative prompt.").waitFor();
  ok(await page.evaluate(() => window.__readClipboard()) === "blurry, text" && await info.getByRole("button", { name: "Copied ✓" }).isVisible(), "without the clipboard API (plain http) copying still works, and the button says Copied");
  await page.keyboard.press("Escape");
  ok(await until(async () => (await info.count()) === 0, "Info to close") && await firstTile.getByRole("button", { name: "More" }).evaluate((b) => b === document.activeElement), "Esc closes it, back on the picture's ☰");
  ok((await page.locator(".picture-caption").first().innerText()) === "fake_sdxl_b · 1344 × 768", "each picture says its checkpoint and size, but not its seed (Info has that)");
  const boxes = await page.locator(".candidates img").evaluateAll((imgs) => imgs.map((i) => { const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  ok(boxes.length === 2 && boxes[1].x > boxes[0].x + boxes[0].w - 1 && Math.abs(boxes[0].y - boxes[1].y) < 2 && boxes[0].w > 300, "at 1000px wide the pictures sit two side by side");
  ok(Math.abs(boxes[0].w - pendingBoxes[0].w) < 2, "…as wide as the places kept for them");
  const clearBox = await page.getByRole("button", { name: "Clear unpinned" }).boundingBox();
  ok(clearBox.y < boxes[0].y, "Clear unpinned is above the pictures");
  const srcs = await page.locator(".candidates img").evaluateAll((imgs) => imgs.map((i) => i.src));
  ok(srcs[0] !== srcs[1] && srcs.every((s) => s.startsWith(`${comfy.url}/view?`) && s.includes("StoryTime_")), "…which come from ComfyUI's /view, each a different picture");
  const [a, b] = await Promise.all(srcs.map(async (s) => Buffer.from(await (await fetch(s)).arrayBuffer())));
  ok(!a.equals(b) && a.subarray(1, 4).toString() === "PNG", "…and are different PNG images");
  ok(await makeButton.isEnabled() && (await queueStatus.innerText()).trim() === "In progress: 0 · Queued: 0", "the button is ready again, and the status is back to nothing queued");

  // what was sent to ComfyUI
  const sent = promptCalls(mark);
  ok(sent.length === 1, "one job was queued");
  const wf = sent[0].body.prompt;
  const nodesOf = (type) => Object.values(wf).filter((n) => n.class_type === type);
  const texts = nodesOf("CLIPTextEncode").map((n) => n.inputs.text);
  ok(texts.includes("a lighthouse at dawn, gulls") && texts.includes("blurry, text"), "the queued workflow has the prompt and the negative prompt");
  ok(nodesOf("CheckpointLoaderSimple")[0].inputs.ckpt_name === "fake_sdxl_b.safetensors", "…the chosen checkpoint");
  const latent = nodesOf("EmptyLatentImage")[0].inputs;
  ok(latent.batch_size === 2 && latent.width === 1344 && latent.height === 768, "…batch_size 2 and the chosen size, as numbers");
  const seed = nodesOf("KSampler")[0].inputs.seed;
  ok(typeof seed === "number" && Number.isInteger(seed) && seed >= 0, "…a numeric seed");
  ok(JSON.stringify(wf).includes("{{") === false, "…and no placeholder left over");
  const clientId = sent[0].body.client_id;
  ok(typeof clientId === "string" && clientId.length > 0 && comfy.calls.slice(mark).some((c) => c.method === "UPGRADE" && c.path === "/ws" && c.query.clientId === clientId), "…with a client id that the page's WebSocket connection also used");
  ok(JSON.stringify(sent[0].body.extra_data) === JSON.stringify({ storytime: { chapterId, storyId } }), "…tagged with the chapter and story, in extra_data");
  ok(nodesOf("SaveImage")[0].inputs.filename_prefix === `StoryTime/${storyId}/${chapterId}`, "…and the pictures are filed under StoryTime/<story>/<chapter>");

  // ---- the job log ----
  const logged = (await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs;
  ok(logged.length === 1 && logged[0].story_id === storyId, "the finished job was recorded for this chapter");
  ok(logged[0].prompt === "a lighthouse at dawn, gulls" && logged[0].negative === "blurry, text" && logged[0].checkpoint === "fake_sdxl_b.safetensors", "…with the prompt, negative prompt and checkpoint");
  ok(logged[0].width === 1344 && logged[0].height === 768 && logged[0].count === 2 && logged[0].seed === seed && logged[0].moment === "start", "…the size, count, seed and the moment chosen");
  ok(logged[0].images.map((i) => i.filename).join() === srcs.map((s) => new URL(s).searchParams.get("filename")).join() && logged[0].images.every((i) => i.type === "output"), "…and where ComfyUI put the two pictures, as shown on the page");

  // ---- using a picture ----
  ok((await card("Header picture").locator("img.image-editor-preview").count()) === 0, "the header picture is empty before");
  ok(await page.getByRole("button", { name: /Use as (header|footer) picture/ }).count() === 0, "Use as header and footer are not buttons on the tile");
  await useAs(items.first(), "header");
  await page.getByText("Saved as the header picture.").waitFor();
  const header = await fetch(`${BASE}/api/chapters/${chapterId}/images/header`);
  const headerBytes = Buffer.from(await header.arrayBuffer());
  ok(header.status === 200 && header.headers.get("content-type") === "image/jpeg" && headerBytes[0] === 0xff && headerBytes[1] === 0xd8, "the chapter's header picture is now a stored JPEG");
  const preview = card("Header picture").locator("img.image-editor-preview");
  await preview.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
  ok(await preview.evaluate((i) => i.naturalWidth > 0), "…and the Header picture card shows it");
  const headerCardBox = await card("Header picture").boundingBox();
  const newBox = await page.locator(".chapter-pictures").boundingBox();
  ok(headerCardBox.y + headerCardBox.height <= newBox.y + 1, "the chosen header and footer cards are above the Pictures panel, to compare with");
  ok((await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`)).status === 404, "…the footer is untouched");
  ok(await items.count() === 2, "the candidates are still there after the page refreshed");
  const savedWith = async () => (await get(`/api/stories/${storyId}/export?format=json`)).images;
  const headerMade = (await savedWith()).find((i) => i.slot === "header");
  ok(headerMade.prompt === "a lighthouse at dawn, gulls" && headerMade.negative === "blurry, text", "the saved header remembers the prompt and negative prompt that made it");

  await useAs(items.nth(1), "footer");
  await page.getByText("Saved as the footer picture.").waitFor();
  const footer = await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`);
  ok(footer.status === 200 && footer.headers.get("content-type") === "image/jpeg", "…and one saves as the footer picture");
  await card("Footer picture").locator("img.image-editor-preview").waitFor();
  ok(true, "…which the Footer picture card shows");
  ok((await savedWith()).find((i) => i.slot === "footer").prompt === "a lighthouse at dawn, gulls", "…and the footer remembers the prompt too");
  const badge = (n) => items.nth(n).locator(".picture-in-use");
  await badge(1).waitFor();
  ok((await badge(0).innerText()).trim() === "Header" && (await badge(1).innerText()).trim() === "Footer", "the pictures in use say so: Header on the first, Footer on the second");

  // ---- the ☰ menu ----
  const more = items.first().getByRole("button", { name: "More" });
  ok(await items.first().getByRole("button", { name: "Load prompt" }).count() === 0 && await items.first().getByRole("button", { name: "Redraw from this" }).count() === 0, "Load prompt and Redraw from this are not buttons on the tile");
  await more.click();
  const menu = items.first().getByRole("menu");
  ok((await menu.getByRole("menuitem").allInnerTexts()).join("|") === "This is the header picture|Use as footer picture|Redraw from this|Edit this|Load prompt|Info|Open in a new tab" && await more.getAttribute("aria-expanded") === "true", "…but in the ☰ menu, after Use as header and footer, with Info and Open in a new tab");
  const inUseItem = menu.getByRole("menuitem", { name: "This is the header picture" });
  ok(await inUseItem.getAttribute("aria-disabled") === "true", "…where the slot the picture is in says so, and can't be chosen again");
  await inUseItem.click({ force: true });
  ok(await menu.count() === 1 && (await savedWith()).find((i) => i.slot === "header").prompt === "a lighthouse at dawn, gulls", "…(clicking it does nothing)");
  ok(await inUseItem.evaluate((e) => e === document.activeElement), "…which puts the keyboard on its first item");
  await page.keyboard.press("ArrowDown");
  ok(await menu.getByRole("menuitem", { name: "Use as footer picture" }).evaluate((e) => e === document.activeElement), "…↓ moves down it");
  await page.keyboard.press("Escape");
  ok(await menu.count() === 0 && await more.evaluate((e) => e === document.activeElement), "Esc closes it, back on the ☰ button");
  await more.click();
  await page.locator(".chapter-pictures h2").click();
  ok(await menu.count() === 0, "…and so does a click elsewhere");

  // ---- bringing a saved picture's prompt back ----
  await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: headerBytes });
  await openIllustrate();
  ok((await promptBox.inputValue()) === "a lighthouse at dawn, gulls", "after a reload the prompt box still has the last prompt (it is kept for the chapter)");
  await promptBox.fill("");
  await negativeBox.fill("");
  const cardMenu = async (title) => {
    await card(title).getByRole("button", { name: "More" }).click();
    return card(title).getByRole("menuitem");
  };
  await card("Header picture").locator("img.image-editor-preview").waitFor();
  ok((await card("Header picture").innerText()).includes("Made from") === false, "the Header picture card has no Made from blurb");
  ok((await (await cardMenu("Header picture")).allInnerTexts()).join("|") === "Replace picture|Redraw from this|Edit this|Load prompt|Open in a new tab|Remove picture", "its ☰ menu has Replace, Redraw from this, Edit this, Load prompt, Open in a new tab and Remove");
  await page.keyboard.press("Escape");
  ok((await (await cardMenu("Footer picture")).allInnerTexts()).includes("Load prompt") === false, "an uploaded picture has no Load prompt");
  await page.keyboard.press("Escape");
  ok((await page.getByRole("checkbox", { name: /Reuse seed/ }).count()) === 0, "there is no Reuse seed box before a prompt is loaded");
  await (await cardMenu("Header picture")).filter({ hasText: "Load prompt" }).click();
  await page.getByText("Prompt loaded from the picture.").waitFor();
  ok((await page.getByText("The loaded picture was made with").count()) === 0, "…which was made with the current checkpoint and size, so there is nothing else to offer");
  ok((await promptBox.inputValue()) === "a lighthouse at dawn, gulls" && (await negativeBox.inputValue()) === "blurry, text", "Load prompt fills in the Prompt and Negative prompt boxes");
  const reuse = page.getByRole("checkbox", { name: `Reuse seed ${seed}` });
  ok(await reuse.isVisible() && !(await reuse.isChecked()), "…and offers Reuse seed with the picture's seed, unticked");
  await promptBox.fill("a lighthouse at dusk, gulls");
  const seedOf = (call) => Object.values(call.body.prompt).find((n) => n.class_type === "KSampler").inputs.seed;
  // The header was made by an earlier job, and the header shows in Pinned & new as if pinned, so one older picture is there before any are made.
  ok(await items.count() === 1 && (await badge(0).innerText()).trim() === "Header", "after a reload the picture used as the header is in Pinned & new although it isn't pinned");
  let from = comfy.calls.length;
  await makeTwo();
  await picturesLoaded(3);
  ok(seedOf(promptCalls(from)[0]) !== seed, "making pictures without the box ticked uses a new seed");
  await reuse.check();
  from = comfy.calls.length;
  await makeTwo();
  await page.waitForFunction(() => document.querySelectorAll(".candidates li.picture-tile").length === 5 && !document.querySelector(".comfy-pending-tile"));
  ok(seedOf(promptCalls(from)[0]) === seed, "with Reuse seed ticked, the queued workflow has the picture's seed");
  const reused = (await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs[0];
  ok(reused.seed === seed && reused.prompt === "a lighthouse at dusk, gulls", "…and the log records that seed with the changed prompt");
  let heads = await headTexts();
  ok(heads.length === 2 && heads[0].startsWith("a lighthouse at dusk, gulls") && heads[0].includes("4 pictures"), "two jobs in a row with the same prompt and settings show as one group, whatever their seed");
  await promptBox.fill("a lighthouse at night");
  await makeTwo();
  await page.waitForFunction(() => document.querySelectorAll(".candidates li.picture-tile").length === 7 && !document.querySelector(".comfy-pending-tile"));
  heads = await headTexts();
  ok(heads.length === 3 && heads[0].startsWith("a lighthouse at night") && heads[1].startsWith("a lighthouse at dusk, gulls"),"…and a new prompt starts a new group, above the older one");
  await (await cardMenu("Header picture")).filter({ hasText: "Load prompt" }).click();
  ok(!(await reuse.isChecked()), "loading a prompt again unticks Reuse seed");

  // ---- bringing back the prompt of any new picture, with its settings ----
  await page.getByLabel("Size").selectOption("1024x1024");
  ok(await until(async () => (await settingsNow()).comfy.width === 1024, "the size to be saved"), "(the size is changed to square)");
  await page.getByLabel("Moment to show").selectOption("end");
  const nightTile = page.locator(".picture-group").first().locator(".picture-tile").first();
  // The newest job is the night one; its pictures show no seed, so it comes from the log.
  const nightSeed = String((await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs[0].seed);
  await nightTile.getByRole("button", { name: "More" }).click();
  await nightTile.getByRole("menuitem", { name: "Load prompt" }).click();
  ok((await promptBox.inputValue()) === "a lighthouse at night" && (await negativeBox.inputValue()) === "blurry, text", "every new picture has Load prompt, which fills in its prompt and negative prompt");
  ok(await page.getByRole("checkbox", { name: `Reuse seed ${nightSeed}` }).isVisible(), "…offers to reuse that picture's own seed");
  ok((await page.getByLabel("Moment to show").inputValue()) === "start", "…and puts back the moment it was made for");
  const offer = page.getByText("The loaded picture was made with 1344 × 768.");
  ok(await offer.isVisible(), "the settings that differ from the current ones are named (here the size)");
  ok((await settingsNow()).comfy.width === 1024, "…but not changed until asked");
  await page.getByRole("button", { name: "Use its settings" }).click();
  ok(await until(async () => (await settingsNow()).comfy.width === 1344 && (await settingsNow()).comfy.height === 768, "the size to be put back"), "Use its settings puts back its size");
  await offer.waitFor({ state: "detached" });
  ok((await page.getByLabel("Size").inputValue()) === "1344x768", "…the Size menu shows it, and the offer goes away");
  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-made-1000.png`, fullPage: true });
  }

  // ---- the page on a phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".candidates").first().scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide: [...document.querySelectorAll(".candidates img, .comfy-generate select, .comfy-generate button")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }));
  ok(overflow.scroll <= overflow.inner, `no sideways scrolling at 390px wide with pictures showing (page ${overflow.scroll}px, window ${overflow.inner}px)`);
  ok(overflow.wide === 0, "…and no picture, menu or button sticks out past the right edge");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => window.scrollY === 0);
  const stuck = await makeButton.boundingBox();
  ok(stuck.y + stuck.height <= 844 && stuck.y > 400, `scrolled to the top, Size, Queue and the status are still at the bottom of the screen (Queue at ${Math.round(stuck.y)}px of 844)`);
  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-comfy-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1000, height: 1300 });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-comfy-1000.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1000, height: 1300 });

  // ---- ComfyUI refuses the workflow ----
  comfy.setMode({ fail: "refuse" });
  await makeButton.click();
  const refused = page.locator(".comfy-generate p.error");
  await refused.waitFor();
  const refusedText = await refused.innerText();
  ok(refusedText.includes("Prompt outputs failed validation") && refusedText.includes("KSampler 3: Required input is missing (positive)"), `a workflow ComfyUI refuses shows its reason: "${refusedText}"`);
  ok(await makeButton.isEnabled() && await items.count() === 7, "…the button is usable again and the earlier pictures are kept");
  comfy.setMode({ fail: null });

  // a checkpoint ComfyUI doesn't have (the saved name outlived the file)
  await call("PATCH", `/api/stories/${storyId}`, { checkpoint: "gone.safetensors" });
  await openIllustrate();
  await promptBox.fill("a lighthouse");
  await page.getByText("ComfyUI doesn't list this story's checkpoint (gone.safetensors). Choose another in Story details.").waitFor();
  ok(true, "a story checkpoint that ComfyUI no longer lists is reported when the page opens");
  await makeButton.click();
  const gone = page.locator(".comfy-generate p.error", { hasText: "Value not in list" });
  await gone.waitFor();
  const goneText = await gone.innerText();
  ok(goneText.includes("CheckpointLoaderSimple") && goneText.includes("gone.safetensors"), `…and trying it shows ComfyUI's node error: "${goneText}"`);
  await call("PATCH", `/api/stories/${storyId}`, { checkpoint: "fake_sdxl_a.safetensors" });
  await openIllustrate();
  ok(await page.locator(".comfy-generate p.error").count() === 0, "choosing a listed checkpoint again fixes it");

  // a job that fails while running
  comfy.setMode({ fail: "error", steps: 6, stepDelay: 100 });
  await makeButton.click();
  await page.getByText(/Out of memory \(fake ComfyUI\)/).waitFor();
  ok(true, "a job that fails inside ComfyUI shows the error it gave");
  comfy.setMode({ fail: null });

  // ---- Stop ----
  comfy.setMode({ steps: 60, stepDelay: 500 });
  const stopMark = comfy.calls.length;
  const countBeforeStop = await items.count();
  await makeButton.click();
  await live.filter({ hasText: /Step \d+ of 60/ }).waitFor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Stopped.").waitFor();
  ok(true, "Stop during a slow job shows Stopped.");
  // The job's places leave the Pictures panel a render after the message shows.
  ok(await until(async () => await makeButton.isEnabled() && await page.getByRole("button", { name: "Stop", exact: true }).count() === 0 && await live.count() === 0, "the stopped job to go"), "…and the page is ready again");
  await until(async () => comfy.calls.slice(stopMark).some((c) => c.path === "/interrupt"), "ComfyUI to be told to interrupt");
  const stopCalls = comfy.calls.slice(stopMark);
  ok(stopCalls.some((c) => c.method === "POST" && c.path === "/queue" && Array.isArray(c.body?.delete) && c.body.delete.length === 1) && stopCalls.some((c) => c.method === "POST" && c.path === "/interrupt"), "…ComfyUI was asked to drop the job from its queue and to interrupt it");
  ok(promptCalls(stopMark).length === 1 && await items.count() === countBeforeStop, "…and no pictures were added by the stopped job");

  // ---- queueing more jobs, with other settings, while one runs ----
  comfy.setMode({ steps: 8, stepDelay: 250 });
  const qMark = comfy.calls.length;
  const qBefore = await items.count();
  await promptBox.fill("first in line");
  await makeTwo();
  await live.filter({ hasText: /Step \d+ of 8/ }).waitFor();
  await promptBox.fill("second in line");
  await makeButton.click();
  // a changed prompt sends the job gathered so far at once, and starts another
  await promptBox.fill("third, to be stopped");
  await makeButton.click();
  await until(async () => (await rows.count()) === 3 && promptCalls(qMark).length === 3, "three jobs");
  const rowHeads = (await headTexts()).slice(0, 3);
  ok(rowHeads[0].startsWith("third, to be stopped") && rowHeads[0].includes("1 being made") && rowHeads[1].startsWith("second in line") && rowHeads[1].includes("1 being made") && rowHeads[2].startsWith("first in line") && rowHeads[2].includes("2 being made"), `jobs queued while one runs are shown newest first, each under its own prompt with its count, so the running one is last (${rowHeads.map((h) => h.split("\n")[0]).join(" / ")})`);
  const rowTops = await rows.evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().top));
  ok(rowTops.length === 3 && rowTops[0] < rowTops[1] && rowTops[1] < rowTops[2], "…top to bottom");
  ok(promptCalls(qMark).map((c) => Object.values(c.body.prompt).find((n) => n.class_type === "EmptyLatentImage").inputs.batch_size).join() === "2,1,1", "…and each was sent with the settings as they were when it was queued");
  await until(async () => /Waiting in ComfyUI's queue/.test(await rows.nth(0).locator("[role=status]").innerText()), "the third job to say it is waiting");
  ok(true, "a job behind others says it is waiting in ComfyUI's queue");
  const iMark = comfy.calls.length;
  await rows.nth(0).getByRole("button", { name: "Stop" }).click();
  await until(async () => (await rows.count()) === 2, "the stopped job to leave the list");
  await until(async () => comfy.calls.slice(iMark).some((c) => c.method === "GET" && c.path === "/queue"), "ComfyUI's queue to be checked");
  await page.waitForTimeout(200);
  const iCalls = comfy.calls.slice(iMark);
  ok(iCalls.some((c) => c.method === "POST" && c.path === "/queue" && c.body?.delete?.length === 1) && !iCalls.some((c) => c.path === "/interrupt"), "stopping a waiting job only takes it off ComfyUI's queue, so the running job isn't interrupted");
  await until(async () => (await items.count()) === qBefore + 3 && (await rows.count()) === 0, "both jobs' pictures", 150);
  ok(true, "the other two jobs finish and add their pictures (2 + 1)");
  const qHeads = await headTexts();
  ok(qHeads[0].startsWith("second in line") && qHeads[0].includes("1 picture") && qHeads[1].startsWith("first in line") && qHeads[1].includes("2 pictures") && !qHeads.some((h) => h.startsWith("third")), "…each under its own prompt, and nothing from the stopped one");

  // ---- the same settings again after others start a new group; straight after, they join it ----
  await promptBox.fill("first in line");
  await makeTwo();
  await until(async () => (await rows.count()) === 0, "the job", 150);
  let abaHeads = await headTexts();
  ok(abaHeads.length === qHeads.length + 1 && abaHeads[0].startsWith("first in line") && abaHeads[1].startsWith("second in line") && abaHeads[2].startsWith("first in line"), "first, second, then first again makes three groups");
  await makeTwo();
  await until(async () => (await headTexts())[0].includes("2 being made"), "the next job to show");
  abaHeads = await headTexts();
  const topGroup = page.locator(".picture-group").first();
  const topClasses = await topGroup.locator(".candidates li").evaluateAll((lis) => lis.map((li) => li.className));
  ok(abaHeads.length === qHeads.length + 1 && abaHeads[0].includes("2 pictures · 2 being made"), "a job with the same settings as the newest group joins it while it is being made");
  ok(topClasses.length === 4 && topClasses.slice(0, 2).every((c) => c.includes("comfy-pending-tile")) && topClasses.slice(2).every((c) => c.includes("picture-tile")), "…with its places first, above the pictures already made");
  await until(async () => (await rows.count()) === 0 && (await headTexts())[0].includes("4 pictures"), "the job to finish", 150);
  ok(true, "…and its pictures stay in that group");

  // ---- at most eight pictures a job ----
  const capMark = comfy.calls.length;
  await promptBox.fill("ten quick clicks");
  for (let i = 0; i < 10; i++) await makeButton.click();
  const jobSize = async (n) => page.locator(`.comfy-pending-tile[data-job="${await rows.nth(n).getAttribute("data-job")}"]`).count();
  // The second job shows at the ninth click, so wait for the tenth to join it too.
  ok(await until(async () => (await rows.count()) === 2 && await jobSize(0) === 2 && await jobSize(1) === 8, "two jobs of 2 and 8"), "ten quick clicks make a job of eight and another of two (newest first)");
  ok((await headTexts())[0].includes("10 being made") && (await headTexts())[1].startsWith("first in line"), "…shown as one group, as their settings are the same");
  await rows.nth(0).getByRole("button", { name: "Stop" }).click();
  ok(await until(async () => (await rows.count()) === 1, "the gathering job to go"), "Stop on a job not sent yet drops it");
  await rows.nth(0).getByRole("button", { name: "Stop" }).click();
  await until(async () => (await rows.count()) === 0, "the other job to stop");
  await page.waitForTimeout(GATHER_WAIT);
  const capCalls = promptCalls(capMark);
  ok(capCalls.length === 1 && Object.values(capCalls[0].body.prompt).find((n) => n.class_type === "EmptyLatentImage").inputs.batch_size === 8, "…so only the job of eight was sent to ComfyUI");

  // ---- the WebSocket refused: the page finds the pictures by polling ----
  comfy.setMode({ ws: false, steps: 2, stepDelay: 100, startDelay: 200, fail: null });
  await openIllustrate();
  await page.getByLabel("Moment to show").selectOption("end");
  await promptBox.fill("a lighthouse in fog");
  const pollMark = comfy.calls.length;
  await makeTwo();
  // The header's picture is already there, so wait for the two new ones.
  await picturesLoaded(3);
  ok(await items.count() === 3, "with no WebSocket, the pictures still arrive (and the header's picture is there too)");
  const pollCalls = comfy.calls.slice(pollMark);
  ok(pollCalls.some((c) => c.method === "UPGRADE") && pollCalls.filter((c) => c.path.startsWith("/history/")).length >= 1, "…found by asking /history after the WebSocket was refused");
  const log = (await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs;
  ok(log.length === 9 && log[0].prompt === "a lighthouse in fog" && log[0].moment === "end" && log[1].moment === "start", "the log has this job (with Chapter end) after the earlier eight, and nothing from the refused, failed or stopped jobs");

  // ---- the job can't be recorded: the pictures are still usable, just without a prompt kept ----
  await page.route("**/api/picture-jobs", (route) => route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk full" }) }) : route.continue());
  await page.getByLabel("Moment to show").selectOption("start");
  await makeTwo();
  await page.getByText(/couldn't record how they were made: disk full/).waitFor({ timeout: 15000 });
  await picturesLoaded(5);
  ok(await items.count() === 5, "when the job can't be recorded, the page says so and still shows the new pictures");
  await page.unroute("**/api/picture-jobs");
  await useAs(items.first(), "header");
  await page.getByText("Saved as the header picture.").waitFor();
  const unrecorded = (await savedWith()).find((i) => i.slot === "header");
  ok(unrecorded.prompt === null && unrecorded.negative === null, "…and a picture from it saves without a prompt, replacing the one before");
  ok((await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 9, "…and nothing was added to the log");

  // ---- clearing ----
  ok(await items.first().getByRole("button", { name: "Pin" }).isDisabled(), "a picture whose job couldn't be recorded can't be pinned");
  await items.nth(2).getByRole("button", { name: "Pin" }).click();
  await page.getByText("Pinned.").waitFor();
  await page.getByRole("button", { name: "Clear unpinned" }).click();
  ok(await items.count() === 1 && await makeButton.innerText() === "Queue", "Clear unpinned leaves only the picture pinned on this visit");
  ok(await page.getByRole("button", { name: "Clear unpinned" }).count() === 0, "…and goes away");
  await openIllustrate();
  ok(await items.count() === 1 && await items.first().getByRole("button", { name: "Unpin" }).count() === 1, "coming back, the pinned picture is still there, and nothing else");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
ok(((await settingsNow())?.comfy?.url ?? "") !== comfy.url, "the fake ComfyUI's address is not left in the settings");
process.exit(failed ? 1 : 0);
