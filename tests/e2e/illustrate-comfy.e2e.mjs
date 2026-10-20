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
const makeButton = page.getByRole("button", { name: /^(Make pictures|Make more|Making pictures…)$/ });
const live = page.locator(".comfy-generate [role=status]");
const items = page.locator(".candidates li");
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
  ok(await page.getByRole("heading", { name: "Make pictures" }).count() === 0 && await makeButton.count() === 0, "…and offers no Make pictures button");
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
  const checkpoint = page.getByLabel("Checkpoint");
  await checkpoint.locator("option", { hasText: "fake_sdxl_b.safetensors" }).waitFor({ state: "attached" });
  const options = await checkpoint.locator("option").allInnerTexts();
  ok(options.includes("fake_sdxl_a.safetensors") && options.includes("fake_sdxl_b.safetensors"), "the Checkpoint list shows the checkpoints from ComfyUI");
  ok(await makeButton.isDisabled(), "Make pictures is off while the prompt is empty");

  await promptBox.fill("a lighthouse at dawn, gulls");
  await negativeBox.fill("blurry, text");
  ok(await makeButton.isEnabled(), "typing your own prompt turns Make pictures on");

  await makeButton.click();
  await page.getByText("Pick a checkpoint first.").waitFor();
  ok(promptCalls().length === 0, "making pictures with no checkpoint chosen says so, and sends nothing to ComfyUI");

  await checkpoint.selectOption("fake_sdxl_b.safetensors");
  ok(await until(async () => (await settingsNow()).comfy.checkpoint === "fake_sdxl_b.safetensors", "the checkpoint to be saved"), "choosing a checkpoint saves it in the settings");
  await page.getByLabel("How many").selectOption("2");
  ok(await until(async () => (await settingsNow()).comfy.count === 2, "the count to be saved"), "How many = 2 is saved too");

  const mark = comfy.calls.length;
  await makeButton.click();
  await live.filter({ hasText: /Step \d+ of 8/ }).waitFor();
  ok(true, "while ComfyUI works, the page shows its progress (Step X of 8)");
  ok(await page.getByRole("button", { name: "Making pictures…" }).isDisabled() && await page.getByRole("button", { name: "Stop", exact: true }).isVisible(), "…the button says Making pictures… and there is a Stop button");
  ok(await page.locator('progress[aria-label="Progress"]').isVisible(), "…with a progress bar");
  await items.first().waitFor();
  await picturesLoaded(2);
  ok(await items.count() === 2, "two pictures appear (How many = 2)");
  ok(await page.getByRole("list", { name: "Pictures from ComfyUI" }).isVisible() && await live.count() === 0, "…in a list of pictures, and the progress text is gone");
  const srcs = await page.locator(".candidates img").evaluateAll((imgs) => imgs.map((i) => i.src));
  ok(srcs[0] !== srcs[1] && srcs.every((s) => s.startsWith(`${comfy.url}/view?`) && s.includes("StoryTime_")), "…which come from ComfyUI's /view, each a different picture");
  const [a, b] = await Promise.all(srcs.map(async (s) => Buffer.from(await (await fetch(s)).arrayBuffer())));
  ok(!a.equals(b) && a.subarray(1, 4).toString() === "PNG", "…and are different PNG images");
  ok(await makeButton.innerText() === "Make more" && await makeButton.isEnabled(), "the button now says Make more");

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
  await page.getByRole("button", { name: "Use as header picture" }).first().click();
  await page.getByText("Saved as the header picture.").waitFor();
  const header = await fetch(`${BASE}/api/chapters/${chapterId}/images/header`);
  const headerBytes = Buffer.from(await header.arrayBuffer());
  ok(header.status === 200 && header.headers.get("content-type") === "image/jpeg" && headerBytes[0] === 0xff && headerBytes[1] === 0xd8, "the chapter's header picture is now a stored JPEG");
  const preview = card("Header picture").locator("img.image-editor-preview");
  await preview.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
  ok(await preview.evaluate((i) => i.naturalWidth > 0), "…and the Header picture card shows it");
  ok((await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`)).status === 404, "…the footer is untouched");
  ok(await items.count() === 2, "the candidates are still there after the page refreshed");
  const savedWith = async () => (await get(`/api/stories/${storyId}/export?format=json`)).images;
  const headerMade = (await savedWith()).find((i) => i.slot === "header");
  ok(headerMade.prompt === "a lighthouse at dawn, gulls" && headerMade.negative === "blurry, text", "the saved header remembers the prompt and negative prompt that made it");

  ok(await page.getByRole("button", { name: "Use as footer picture" }).count() === 2 && await page.getByRole("button", { name: "Use as header picture" }).count() === 2, "every picture can be used as the header or the footer");
  await page.getByRole("button", { name: "Use as footer picture" }).nth(1).click();
  await page.getByText("Saved as the footer picture.").waitFor();
  const footer = await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`);
  ok(footer.status === 200 && footer.headers.get("content-type") === "image/jpeg", "…and one saves as the footer picture");
  await card("Footer picture").locator("img.image-editor-preview").waitFor();
  ok(true, "…which the Footer picture card shows");
  ok((await savedWith()).find((i) => i.slot === "footer").prompt === "a lighthouse at dawn, gulls", "…and the footer remembers the prompt too");

  // ---- bringing a saved picture's prompt back ----
  await fetch(`${BASE}/api/chapters/${chapterId}/images/footer`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: headerBytes });
  await openIllustrate();
  ok((await promptBox.inputValue()) === "", "after a reload the prompt box is empty again");
  const madeFrom = card("Header picture").locator(".image-made");
  await madeFrom.waitFor();
  ok((await madeFrom.innerText()).includes("Made from: a lighthouse at dawn, gulls"), "the Header picture card says what it was made from");
  ok((await madeFrom.innerText()).includes(`fake_sdxl_b.safetensors · 1344 × 768 · seed ${seed}`), "…with the checkpoint, size and seed");
  ok((await card("Footer picture").locator(".image-made").count()) === 0 && (await card("Footer picture").locator("img.image-editor-preview").count()) === 1, "an uploaded picture shows no Made from");
  ok((await page.getByRole("checkbox", { name: /Reuse seed/ }).count()) === 0, "there is no Reuse seed box before a prompt is loaded");
  await madeFrom.getByRole("button", { name: "Load prompt" }).click();
  await page.getByText("Prompt loaded from the saved picture.").waitFor();
  ok((await promptBox.inputValue()) === "a lighthouse at dawn, gulls" && (await negativeBox.inputValue()) === "blurry, text", "Load prompt fills in the Prompt and Negative prompt boxes");
  const reuse = page.getByRole("checkbox", { name: `Reuse seed ${seed}` });
  ok(await reuse.isVisible() && !(await reuse.isChecked()), "…and offers Reuse seed with the picture's seed, unticked");
  await promptBox.fill("a lighthouse at dusk, gulls");
  const seedOf = (call) => Object.values(call.body.prompt).find((n) => n.class_type === "KSampler").inputs.seed;
  let from = comfy.calls.length;
  await makeButton.click();
  await picturesLoaded(2);
  ok(seedOf(promptCalls(from)[0]) !== seed, "making pictures without the box ticked uses a new seed");
  await reuse.check();
  from = comfy.calls.length;
  await makeButton.click();
  await page.waitForFunction(() => document.querySelectorAll(".candidates li").length === 4);
  ok(seedOf(promptCalls(from)[0]) === seed, "with Reuse seed ticked, the queued workflow has the picture's seed");
  const reused = (await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs[0];
  ok(reused.seed === seed && reused.prompt === "a lighthouse at dusk, gulls", "…and the log records that seed with the changed prompt");
  await card("Header picture").getByRole("button", { name: "Load prompt" }).click();
  ok(!(await reuse.isChecked()), "loading a prompt again unticks Reuse seed");
  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-made-1000.png`, fullPage: true });
  }

  // ---- the page on a phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".candidates").scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide: [...document.querySelectorAll(".candidates img, .comfy-generate select, .comfy-generate button")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }));
  ok(overflow.scroll <= overflow.inner, `no sideways scrolling at 390px wide with pictures showing (page ${overflow.scroll}px, window ${overflow.inner}px)`);
  ok(overflow.wide === 0, "…and no picture, menu or button sticks out past the right edge");
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
  ok(await makeButton.isEnabled() && await items.count() === 4, "…the button is usable again and the earlier pictures are kept");
  comfy.setMode({ fail: null });

  // a checkpoint ComfyUI doesn't have (the saved name outlived the file)
  await putSettings({ ...(await settingsNow()), comfy: { ...(await settingsNow()).comfy, checkpoint: "gone.safetensors" } });
  await openIllustrate();
  await promptBox.fill("a lighthouse");
  ok(await page.getByLabel("Checkpoint").inputValue() === "gone.safetensors", "a saved checkpoint that ComfyUI no longer lists is still shown");
  await makeButton.click();
  const gone = page.locator(".comfy-generate p.error");
  await gone.waitFor();
  const goneText = await gone.innerText();
  ok(goneText.includes("Value not in list") && goneText.includes("CheckpointLoaderSimple") && goneText.includes("gone.safetensors"), `…and trying it shows ComfyUI's node error: "${goneText}"`);
  await page.getByLabel("Checkpoint").selectOption("fake_sdxl_a.safetensors");
  ok(await until(async () => (await settingsNow()).comfy.checkpoint === "fake_sdxl_a.safetensors", "the checkpoint to be saved"), "choosing a listed checkpoint again fixes it");

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
  ok(await makeButton.isEnabled() && await page.getByRole("button", { name: "Stop", exact: true }).count() === 0 && await live.count() === 0, "…and the page is ready again");
  await until(async () => comfy.calls.slice(stopMark).some((c) => c.path === "/interrupt"), "ComfyUI to be told to interrupt");
  const stopCalls = comfy.calls.slice(stopMark);
  ok(stopCalls.some((c) => c.method === "POST" && c.path === "/queue" && Array.isArray(c.body?.delete) && c.body.delete.length === 1) && stopCalls.some((c) => c.method === "POST" && c.path === "/interrupt"), "…ComfyUI was asked to drop the job from its queue and to interrupt it");
  ok(promptCalls(stopMark).length === 1 && await items.count() === countBeforeStop, "…and no pictures were added by the stopped job");

  // ---- the WebSocket refused: the page finds the pictures by polling ----
  comfy.setMode({ ws: false, steps: 2, stepDelay: 100, startDelay: 200, fail: null });
  await openIllustrate();
  await promptBox.fill("a lighthouse in fog");
  await page.getByLabel("Moment to show").selectOption("end");
  const pollMark = comfy.calls.length;
  await makeButton.click();
  await page.locator(".candidates li").first().waitFor({ timeout: 15000 });
  await picturesLoaded(await items.count());
  ok(await items.count() === 2, "with no WebSocket, the pictures still arrive");
  const pollCalls = comfy.calls.slice(pollMark);
  ok(pollCalls.some((c) => c.method === "UPGRADE") && pollCalls.filter((c) => c.path.startsWith("/history/")).length >= 1, "…found by asking /history after the WebSocket was refused");
  const log = (await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs;
  ok(log.length === 4 && log[0].prompt === "a lighthouse in fog" && log[0].moment === "end" && log[1].moment === "start", "the log has this job (with Chapter end) after the earlier three, and nothing from the refused, failed or stopped jobs");

  // ---- the job can't be recorded: the pictures are still usable, just without a prompt kept ----
  await page.route("**/api/picture-jobs", (route) => route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk full" }) }) : route.continue());
  await page.getByLabel("Moment to show").selectOption("start");
  await makeButton.click();
  await page.getByText(/couldn't record how they were made: disk full/).waitFor({ timeout: 15000 });
  await picturesLoaded(4);
  ok(await items.count() === 4, "when the job can't be recorded, the page says so and still shows the new pictures");
  await page.unroute("**/api/picture-jobs");
  await page.getByRole("button", { name: "Use as header picture" }).first().click();
  await page.getByText("Saved as the header picture.").waitFor();
  const unrecorded = (await savedWith()).find((i) => i.slot === "header");
  ok(unrecorded.prompt === null && unrecorded.negative === null, "…and a picture from it saves without a prompt, replacing the one before");
  ok((await get(`/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 4, "…and nothing was added to the log");

  // ---- clearing ----
  await page.getByRole("button", { name: "Clear these pictures" }).click();
  ok(await items.count() === 0 && await makeButton.innerText() === "Make pictures", "Clear these pictures empties the list");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
ok(((await settingsNow())?.comfy?.url ?? "") !== comfy.url, "the fake ComfyUI's address is not left in the settings");
process.exit(failed ? 1 : 0);
