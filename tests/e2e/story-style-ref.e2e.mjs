// The story's style picture: chosen on the details page (Choose…, Strength, Remove), shown first in the
// References section of the Illustrate, cover and codex pages with a switch, and sent as an IP-Adapter
// "style transfer" reference with each drawing job unless switched off (and never with an Instruct).
// Against the fake ComfyUI with the IP-Adapter nodes and files.
import fs from "node:fs";
import { comfySettings, launch } from "./browser.mjs";
import { makePng, startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3581;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 150) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const NOOB = "noobaiXL_vpred10.safetensors";
const created = await call("POST", "/api/stories", { title: "Style saga", premise: "A keeper guards a lonely beacon.", chapter: { title: "The lamp", body: "Zephyr climbed the stairs.", choices: [] } });
const { story_id: storyId, chapter_id: chapter } = created;
const putImage = (url, bytes) => fetch(BASE + url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: bytes });
await putImage(`/api/stories/${storyId}/cover`, makePng(3));
await putImage(`/api/chapters/${chapter}/images/header`, makePng(0));
await putImage(`/api/chapters/${chapter}/images/footer`, makePng(1));

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({
  port: COMFY_PORT, steps: 2, stepDelay: 50, startDelay: 80, checkpoints: [NOOB], ipAdapter: true,
  files: { ipadapter: ["noobIPAMARK1_mark1.safetensors"], clip_vision: ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"] },
});
const noob = { id: "noob", name: "Noob", checkpoint: NOOB, workflow: "", loras: [], sampler: {}, denoise: 0.55 };
await putSettings({ ...(before ?? {}), comfy: { ...comfySettings({ url: comfy.url, count: 1 }), drawPresets: [noob] } });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1500 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const card = page.locator("#pictures");
const picker = page.getByRole("dialog", { name: "Add a reference" });
const section = page.locator("#picture-references");
const styleRow = section.locator(".story-style");
const useStyle = section.getByLabel("Use the story's style picture");
const queue = page.getByRole("button", { name: "Queue", exact: true });
const tiles = page.locator("li.picture-tile");
const prompts = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").map((c) => c.body.prompt);
const nodes = (wf, type) => Object.entries(wf).filter(([, n]) => n.class_type === type);
const ready = async () => (await page.locator(".comfy-pending-tile [role=status]").count()) === 0;
const made = async (n) => until(async () => (await tiles.count()) === n && (await ready()), `${n} picture(s)`);

try {
  // ---- choosing it on the details page ----
  await page.goto(`${BASE}/s/${storyId}/details`);
  await card.waitFor();
  ok((await card.innerText()).includes("Style picture (optional)") && (await card.getByRole("button", { name: "Remove" }).count()) === 0, "the picture card has an empty Style picture (optional)");
  await card.getByRole("button", { name: "Choose…" }).click();
  await picker.waitFor();
  ok((await picker.getByRole("tab").allInnerTexts()).join("|") === "Suggested|Pictures|Codex", "the picker has no Upload tab");
  await picker.getByRole("tab", { name: "Pictures" }).click();
  await picker.getByRole("button", { name: /Cover/ }).click();
  await picker.waitFor({ state: "detached" });
  ok((await card.getByRole("img", { name: "Style picture" }).count()) === 1, "the chosen picture shows as a thumbnail");
  ok(await card.getByLabel("Style picture strength").inputValue() === "0.8", "…with the default strength 0.8");
  await card.getByLabel("Style picture strength").fill("0.6");
  await card.getByRole("button", { name: "Save picture settings" }).click();
  await card.getByText("Picture settings saved.").waitFor();
  const saved = (await call("GET", `/api/stories/${storyId}`)).style_ref;
  ok(saved?.source === `saved:${storyId}:cover` && saved.role === "style" && saved.weight === 0.6, "Save picture settings keeps it on the story");
  await page.reload();
  await card.waitFor();
  ok(await card.getByLabel("Style picture strength").inputValue() === "0.6" && (await card.getByRole("img", { name: "Style picture" }).count()) === 1, "…and it is there after a reload");

  // ---- on the Illustrate page ----
  await page.goto(`${BASE}/c/${chapter}/illustrate`);
  await section.waitFor();
  await styleRow.waitFor();
  ok((await styleRow.innerText()).includes("Story style") && (await styleRow.innerText()).includes("0.60") && await useStyle.isChecked(), "the Illustrate page shows the story style first, ticked, with its strength");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a lamp on a rock");
  await queue.click();
  await made(1);
  let wf = prompts().at(-1);
  let ref = nodes(wf, "IPAdapterAdvanced");
  ok(ref.length === 1 && ref[0][1].inputs.weight_type === "style transfer" && ref[0][1].inputs.weight === 0.6, "the job has an IPAdapterAdvanced with weight type “style transfer” at the story's strength");

  // Unticked, it isn't sent, and that is remembered after a reload.
  await useStyle.uncheck();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a lamp in a storm");
  await queue.click();
  await made(2);
  wf = prompts().at(-1);
  ok(nodes(wf, "IPAdapterAdvanced").length === 0, "with the box unticked no reference is sent");
  await page.reload();
  await styleRow.waitFor();
  ok(!(await useStyle.isChecked()), "…and it stays unticked after a reload");

  // It counts toward the limit of 4.
  await useStyle.check();
  const add = section.getByRole("button", { name: "Add reference" });
  for (let i = 0; i < 3; i++) {
    await add.click();
    await picker.waitFor();
    await picker.getByRole("tab", { name: "Pictures" }).click();
    await picker.locator("li button:enabled").first().click();
    await picker.waitFor({ state: "detached" });
  }
  ok((await section.locator("li.reference-item").count()) === 3 && await add.isDisabled(), "three references next to the story style fill the limit of 4");
  await useStyle.uncheck();
  ok(!(await add.isDisabled()), "…and unticking it frees a place");
  await useStyle.check();

  // ---- the cover page ----
  await page.goto(`${BASE}/s/${storyId}/cover`);
  await styleRow.waitFor();
  ok(await useStyle.isChecked(), "the cover page shows it too, ticked by default");

  if (process.env.E2E_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    for (const [width, height] of [[1000, 1500], [390, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}/s/${storyId}/details`);
      await card.waitFor();
      await page.waitForTimeout(400);
      await card.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/story-style-card-${width}.png` });
      await page.goto(`${BASE}/c/${chapter}/illustrate`);
      await section.waitFor();
      await page.waitForTimeout(400);
      await section.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/story-style-refs-${width}.png` });
      ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `at ${width}px the Illustrate page does not scroll sideways`);
    }
  }

  // ---- removing it ----
  await page.goto(`${BASE}/s/${storyId}/details`);
  await card.waitFor();
  await card.getByRole("button", { name: "Remove" }).click();
  await card.getByRole("button", { name: "Save picture settings" }).click();
  await card.getByText("Picture settings saved.").waitFor();
  ok((await call("GET", `/api/stories/${storyId}`)).style_ref === null, "Remove and save takes the style picture off the story");
  await page.goto(`${BASE}/c/${chapter}/illustrate`);
  await section.waitFor();
  ok((await styleRow.count()) === 0, "…and the Illustrate page no longer shows it");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
