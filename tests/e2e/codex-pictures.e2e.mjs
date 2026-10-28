// Pictures of codex entries: the Make a picture link in the Codex panel, the codex page (/s/<id>/codex/<entry>?at=)
// with a prompt written by the (fake) model from the entry's text, pictures made on a fake ComfyUI and filed under
// the entry, saving one from the start and another from a chapter on (the earlier chapter keeps the first), the
// thumbnails in the Codex panel, and choosing codex pictures as references on an Illustrate page, from the Codex
// tab and as a suggestion for a name in the prompt, kept and restored after a reload.
import http from "node:http";
import { comfySettings, launch, useMockAi } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3590;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// ---- a fake model that records what it was asked ----
const asked = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : {};
    if (!body.messages) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [] })); }
    asked.push({ system: body.messages[0].content, user: body.messages.at(-1).content });
    res.setHeader("content-type", "text/event-stream");
    const reply = '{"scene":"A keeper, full length.","prompt":"1man, old, grey beard, oilskin coat, full body, plain background","negative":"text, watermark"}';
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

// ---- a story with two chapters and a codex entry ----
// No automatic codex check of the chapters made here: it would ask the fake model too.
const before = (await call("GET", "/api/settings")).settings;
await putSettings({ ...(before ?? {}), autoCodex: false });
const NOOB = "noobaiXL_vpred10.safetensors";
const created = await call("POST", "/api/stories", { title: "Codex pictures saga", premise: "A keeper guards a lonely beacon.", chapter: { title: "The lamp", body: "Zephyr climbed the stairs.", choices: ["Go down"] } });
const { story_id: storyId, chapter_id: first } = created;
const choice = (await call("GET", `/api/chapters/${first}`)).choices[0];
const second = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "The cellar", body: "Water rose in the cellar.", choices: [] })).chapter_id;
const zephyr = (await call("POST", "/api/codex", { anchor_chapter_id: first, op: "create", name: "Zephyr", type: "character", aliases: ["the Keeper"], content: "An old lighthouse keeper with a grey beard and an oilskin coat." })).entry_id;
const cellarEntry = (await call("POST", "/api/codex", { anchor_chapter_id: first, op: "create", name: "Cellar", type: "place", content: "A flooded stone cellar." })).entry_id;
// The picture prompt is written from the entry's facts (its notes are the author's own).
await call("POST", "/api/codex/facts", { anchor_chapter_id: first, entry_id: zephyr, op: "set", aspect: "", text: "An old lighthouse keeper with a grey beard and an oilskin coat." });
await call("POST", "/api/codex/facts", { anchor_chapter_id: first, entry_id: cellarEntry, op: "set", aspect: "", text: "A flooded stone cellar." });

const ai = await useMockAi(BASE, { favorites: [], imagePromptModel: null });
const comfy = await startFakeComfy({
  port: COMFY_PORT, steps: 2, stepDelay: 50, startDelay: 80, checkpoints: [NOOB], ipAdapter: true,
  files: { ipadapter: ["noobIPAMARK1_mark1.safetensors"], clip_vision: ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"] },
});
const noob = { id: "noob", name: "Noob", checkpoint: NOOB, workflow: "", loras: [], sampler: {}, denoise: 0.55 };
await putSettings({ ...((await call("GET", "/api/settings")).settings ?? {}), comfy: { ...comfySettings({ url: comfy.url, count: 1 }), drawPresets: [noob] } });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1500 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

// The picture page of an entry (the entry's own page is `/s/<story>/codex/<entry>`).
const codexUrl = (at) => `/s/${storyId}/codex/${zephyr}/pictures${at ? `?at=${at}` : ""}`;
const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
const queueButton = page.getByRole("button", { name: "Queue", exact: true });
const tiles = page.locator(".candidates li.picture-tile");
const card = page.locator(".image-editor", { has: page.getByRole("heading", { name: "Codex picture" }) });
const section = page.locator("#picture-references");
const rows = section.locator("li.reference-item");
const picker = page.getByRole("dialog", { name: "Add a reference" });
const add = section.getByRole("button", { name: "Add reference" });
const pictureAt = async (chapter, entry = zephyr) => (await call("GET", `/api/stories/${storyId}/codex-pictures?chapter=${chapter}`)).pictures[entry]?.id ?? null;
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");
const makeOne = async (n) => {
  await queueButton.click();
  await until(async () => (await tiles.count()) === n && (await page.locator(".comfy-pending-tile [role=status]").count()) === 0, `picture ${n}`);
};
const useFor = async (menuName) => {
  await tiles.first().getByRole("button", { name: "More" }).click();
  await tiles.first().getByRole("menuitem", { name: menuName }).click();
  await page.getByText(/^Saved as the codex picture/).waitFor();
};

try {
  // ---- the Codex panel links to the page ----
  await page.goto(`${BASE}/c/${first}/codex`);
  const entryCard = page.locator(".entry-card", { hasText: "Zephyr" });
  await entryCard.waitFor();
  ok((await entryCard.locator("img.codex-thumb").count()) === 0, "an entry without a picture has no thumbnail in the list");
  await entryCard.click();
  await page.getByRole("heading", { name: "Zephyr", level: 1 }).waitFor();
  const link = page.getByRole("link", { name: "Pictures", exact: true });
  ok((await link.getAttribute("href")) === codexUrl(first), "the entry's page has a Pictures link to its picture page, with ?at= the chapter");
  await link.click();
  await page.waitForURL(`${BASE}${codexUrl(first)}`);
  await page.getByRole("heading", { name: "Codex picture prompt" }).waitFor();
  ok(await page.getByRole("heading", { name: "Picture of “Zephyr”", level: 1 }).isVisible(), "the picture page has the heading Picture of “Zephyr”");
  ok((await page.getByRole("link", { name: "← Back to “Zephyr”" }).getAttribute("href")) === `/s/${storyId}/codex/${zephyr}?at=${first}`, "…and a link back to the entry's page at the chapter it came from");
  ok(await card.getByText("No picture yet").isVisible(), "the Codex picture card says there is no picture yet");

  // ---- the prompt is written from the entry's text ----
  await page.getByRole("button", { name: "Write prompt", exact: true }).click();
  await until(() => asked.length === 1 && page.getByRole("button", { name: "Write again" }).isVisible(), "the prompt to be written", 60);
  ok(asked[0].user.includes("Zephyr (character)") && asked[0].user.includes("grey beard") && asked[0].user.includes("the Keeper"), "the request has the entry's name, type, aliases and text");
  ok(asked[0].system.includes("full-body") && asked[0].system.includes("plain, simple background"), "…and asks for one full-body picture on a plain background");
  ok((await promptBox.inputValue()).startsWith("1man, old, grey beard"), "the written prompt fills the Prompt box");

  // ---- making a picture, filed under the entry ----
  await makeOne(1);
  const sent = posted();
  const prefix = Object.values(sent[0].body.prompt).find((n) => n.class_type === "SaveImage")?.inputs.filename_prefix;
  ok(prefix === `StoryTime/${storyId}/codex/${zephyr}`, `ComfyUI was told to file the picture under StoryTime/<story>/codex/<entry> (${prefix})`);
  const tag = sent[0].body.extra_data?.storytime;
  ok(tag?.chapterId === null && tag?.entryId === zephyr && tag?.job?.moment === "codex", "…and the job is tagged with the entry (no chapter, moment codex)");
  await until(async () => (await call("GET", `/api/picture-jobs?story=${storyId}&entry=${zephyr}`)).jobs.length === 1, "the job to be recorded", 50);
  const job = (await call("GET", `/api/picture-jobs?story=${storyId}&entry=${zephyr}`)).jobs[0];
  ok(job.moment === "codex" && job.entry_id === zephyr && job.chapter_id === null, "the finished job is recorded for the entry");

  // ---- saving it from the start ----
  await tiles.first().getByRole("button", { name: "More" }).click();
  const items = (await tiles.first().getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
  ok(items.includes("Use as codex picture, from the start") && items.includes("Use as codex picture, from “The lamp” on") && !items.some((t) => /header|footer|cover/i.test(t)), `the ☰ menu has Use as codex picture, from the start and from the chapter on (${items.join("|")})`);
  await page.keyboard.press("Escape");
  await useFor("Use as codex picture, from the start");
  const one = await pictureAt(first);
  ok(one !== null && (await pictureAt(second)) === one, "saving from the start gives the entry a picture at every chapter");
  await card.locator("img.image-editor-preview").waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
  ok((await card.innerText()).includes("From the start"), "the Codex picture card shows it, from the start");
  await tiles.first().locator(".picture-in-use").waitFor();
  ok((await tiles.first().locator(".picture-in-use").innerText()).trim() === "Codex", "…and the picture's tile says Codex");
  ok(await until(async () => (await call("GET", `/api/picture-jobs?story=${storyId}&entry=${zephyr}`)).jobs[0].marks[0] === "pinned", "the pin"), "…and the picture is pinned");

  // ---- the Codex panel shows it ----
  await page.goto(`${BASE}/c/${first}/codex`);
  const thumb = page.locator(".entry-card", { hasText: "Zephyr" }).locator("img.codex-thumb");
  await thumb.waitFor();
  ok((await thumb.getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "the codex list shows the entry's picture as a thumbnail");
  ok((await page.locator(".entry-card", { hasText: "Cellar" }).locator("img.codex-thumb").count()) === 0, "an entry without a picture has no thumbnail");
  await page.goto(`${BASE}/s/${storyId}/codex/${zephyr}?at=${first}`);
  ok((await page.locator(".entry-head img.codex-thumb").getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "the entry's page shows it too, linked to the picture page");

  // ---- another picture from the second chapter on ----
  await page.goto(`${BASE}${codexUrl(second)}`);
  await page.getByRole("heading", { name: "Codex picture prompt" }).waitFor();
  await card.locator("img.image-editor-preview").waitFor();
  ok((await card.innerText()).includes("From the start"), "opened from the second chapter, the card shows the first picture");
  await promptBox.fill("1man, old, grey beard, flooded cellar, wading, full body");
  await makeOne(2); // (the first, pinned, picture is listed too)
  const items2 = await (async () => { await tiles.first().getByRole("button", { name: "More" }).click(); const t = (await tiles.first().getByRole("menuitem").allInnerTexts()).map((x) => x.trim()); await page.keyboard.press("Escape"); return t; })();
  ok(items2.includes("Use as codex picture, from “The cellar” on"), "the menu offers saving from the chapter the page was opened from");
  await useFor("Use as codex picture, from “The cellar” on");
  const two = await pictureAt(second);
  ok(two !== null && two !== one && (await pictureAt(first)) === one, "the second chapter has the new picture and the first chapter still has the first");
  await page.waitForFunction(() => document.body.innerText.includes("From “The cellar” on"));
  ok(true, "the card says it is from the chapter on");

  // ---- no ?at= means the whole story's picture ----
  await page.goto(`${BASE}${codexUrl(null)}`);
  await page.getByRole("heading", { name: "Codex picture prompt" }).waitFor();
  await card.locator("img.image-editor-preview").waitFor();
  ok((await card.innerText()).includes("From the start") && (await card.locator("img.image-editor-preview").getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "without ?at= the page shows the picture from the start");
  await tiles.first().getByRole("button", { name: "More" }).click();
  const items3 = (await tiles.first().getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
  ok(items3.includes("Use as codex picture, from the start") && !items3.some((t) => /on$/.test(t)), "…and the menu offers only from the start");
  await page.keyboard.press("Escape");

  // ---- the Codex panel as of each chapter ----
  await page.goto(`${BASE}/c/${second}/codex`);
  const thumb2 = page.locator(".entry-card", { hasText: "Zephyr" }).locator("img.codex-thumb");
  await thumb2.waitFor();
  ok((await thumb2.getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${two}`, "the Codex panel at the second chapter shows the second picture");
  await page.goto(`${BASE}/c/${first}/codex`);
  await page.locator(".entry-card", { hasText: "Zephyr" }).locator("img.codex-thumb").waitFor();
  ok((await page.locator(".entry-card", { hasText: "Zephyr" }).locator("img.codex-thumb").getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "…and at the first chapter, the first");

  // ---- the picture queue names the job ----
  // (a slow job, left by the page)
  comfy.setMode({ steps: 10, stepDelay: 200 });
  await page.goto(`${BASE}${codexUrl(second)}`);
  await page.getByRole("heading", { name: "Codex picture prompt" }).waitFor();
  await queueButton.click();
  await until(() => posted().length === 3, "the slow job to be sent", 60);
  await page.getByRole("link", { name: "StoryTime", exact: true }).first().click();
  await page.waitForURL(`${BASE}/`);
  const badge = page.locator(".site-header .picture-queue-button");
  await badge.waitFor();
  await badge.click();
  const row = page.getByRole("region", { name: "Queue" }).getByRole("listitem", { name: /^Zephyr \(codex\): (being made|ready)$/ });
  await row.waitFor();
  ok((await row.innerText()).includes("Codex pictures saga"), "the header's job list calls the job “Zephyr (codex)”, with the story's title");
  const ready = page.getByRole("region", { name: "Queue" }).getByRole("listitem", { name: "Zephyr (codex): ready" });
  await ready.waitFor({ timeout: 20000 });
  ok((await ready.getByRole("link", { name: "Open", exact: true }).getAttribute("href")) === `/s/${storyId}/codex/${zephyr}/pictures`, "…and its Open link is the entry's picture page");
  comfy.setMode({ steps: 2, stepDelay: 50 });

  // ---- references on an Illustrate page: the Codex tab ----
  await page.goto(`${BASE}/c/${second}/illustrate`);
  await add.waitFor();
  await add.click();
  await picker.getByRole("tab", { name: "Codex" }).click();
  const choices = picker.locator("li button.reference-choice");
  ok((await choices.count()) === 1 && (await choices.first().innerText()).includes("Zephyr"), "the Add reference picker has a Codex tab listing the entries with a picture (Zephyr, not the Cellar)");
  ok((await choices.first().locator("img").getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${two}`, "…with the picture as of this chapter");
  await choices.first().click();
  await until(async () => (await rows.count()) === 1, "the reference");
  ok((await rows.first().getByLabel("Label of reference 1").inputValue()) === "Zephyr" && (await rows.first().getByLabel("Role of reference 1").inputValue()) === "character", "choosing it adds a reference labelled with the entry's name, as a character");
  await until(async () => (await call("GET", `/api/chapters/${second}/picture-draft`)).draft?.start.refs.length === 1, "the reference to be kept");
  ok((await call("GET", `/api/chapters/${second}/picture-draft`)).draft.start.refs[0].source === `codex:${two}`, "it is kept as codex:<picture id>");
  await page.reload();
  await until(async () => (await rows.count()) === 1, "the reference to come back");
  ok((await rows.first().getByLabel("Label of reference 1").inputValue()) === "Zephyr" && (await rows.first().locator("img").getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${two}`, "after a reload the codex reference is restored, with its picture");
  await queueButton.waitFor();
  await promptBox.fill("a lamp room");
  await queueButton.click();
  await until(() => posted().length === 4, "the job with a reference to be sent", 60);
  const logged = await until(async () => (await call("GET", `/api/picture-jobs?chapter=${second}`)).jobs.some((j) => (j.refs ?? []).length === 1), "the job to be recorded", 50);
  const withRef = logged && (await call("GET", `/api/picture-jobs?chapter=${second}`)).jobs.find((j) => (j.refs ?? []).length === 1);
  ok(withRef && JSON.stringify(withRef.refs) === JSON.stringify([{ source: `codex:${two}`, label: "Zephyr", role: "character", weight: 0.4 }]), "the job log records the codex reference");
  ok(Object.values(posted()[3].body.prompt).some((n) => n.class_type === "IPAdapterAdvanced"), "…and the workflow sent has an IP-Adapter for it");

  // ---- …as of the first chapter it is the first picture, and a name in the prompt suggests it ----
  await page.goto(`${BASE}/c/${first}/illustrate`);
  await add.waitFor();
  await add.click();
  ok((await picker.getByRole("tab", { name: "Suggested" }).getAttribute("aria-selected")) === "false" && (await picker.getByRole("tab", { name: "Pictures" }).getAttribute("aria-selected")) === "true", "with nothing suggested the picker opens on Pictures");
  await picker.getByRole("tab", { name: "Codex" }).click();
  ok((await picker.locator("li button.reference-choice img").first().getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "at the first chapter the Codex tab has the first picture");
  await page.keyboard.press("Escape");
  await promptBox.fill("the keeper, at dawn");
  await add.click();
  ok((await picker.getByRole("tab", { name: "Suggested" }).getAttribute("aria-selected")) === "true", "a name or alias in the prompt (“the keeper”, any case) makes the picker open on Suggested");
  const suggestion = picker.locator("li button.reference-choice", { hasText: "Zephyr" });
  ok((await suggestion.count()) === 1 && (await suggestion.innerText()).includes("Named in the prompt"), "…with Zephyr suggested, as named in the prompt");
  await suggestion.click();
  await until(async () => (await rows.count()) === 1, "the suggested reference");
  ok((await rows.first().getByLabel("Label of reference 1").inputValue()) === "Zephyr", "choosing the suggestion adds the reference");
  await until(async () => (await call("GET", `/api/chapters/${first}/picture-draft`)).draft?.start.refs[0]?.source === `codex:${one}`, "the reference to be kept");
  ok(true, "…keeping the first picture, as of this chapter");
  await promptBox.fill("keeperless dawn");
  await add.click();
  ok((await picker.locator("li button.reference-choice", { hasText: "Named in the prompt" }).count()) === 0, "a word that only contains the name isn't a mention (“keeperless”)");
  await page.keyboard.press("Escape");

  // ---- the cover page's Codex tab lists the whole story's pictures ----
  await page.goto(`${BASE}/s/${storyId}/cover`);
  await page.getByRole("heading", { name: "Cover prompt" }).waitFor();
  await add.click();
  await picker.getByRole("tab", { name: "Codex" }).click();
  ok((await picker.locator("li button.reference-choice img").first().getAttribute("src")) === `/api/stories/${storyId}/codex-pictures/${one}`, "the cover page's Codex tab has the pictures that start at the beginning of the story");
  await page.keyboard.press("Escape");
  void cellarEntry;
} finally {
  // Later tests share the database: leave no job marked as new.
  const unseen = (await call("GET", "/api/picture-jobs?unseen=1")).jobs.map((j) => j.id);
  await call("POST", "/api/picture-jobs/seen", { ids: unseen });
  await ai.restore();
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
