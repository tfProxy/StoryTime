// Leaving or refreshing the Illustrate page while ComfyUI is making pictures: the page finds the job again in
// ComfyUI's queue, shows it being made, and records it; a job that finished while the page was away is
// recorded when the page comes back, and none is listed twice.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3559;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Away", chapter: { title: "The lamp", body: "The keeper lit the lamp.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
// Slow enough that a job is still running when the page is refreshed.
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 8, stepDelay: 150, startDelay: 200 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const queueButton = page.getByRole("button", { name: "Queue", exact: true });
const pendingTiles = page.locator(".comfy-pending-tile");
const tiles = page.locator(".candidates li.picture-tile");
const jobs = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs;
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").length;
const open = async () => {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
};

try {
  await open();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a keeper beside a lamp");

  // ---- refreshed while the job is running ----
  await queueButton.click();
  await until(() => posted() === 1, "the job to be sent to ComfyUI", 60);
  await pendingTiles.first().waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok(await until(async () => (await pendingTiles.count()) === 1, "the job to show again after the refresh", 40), "after a refresh the job ComfyUI is still making shows again, as being made");
  ok(await until(async () => (await tiles.count()) === 1 && (await pendingTiles.count()) === 0, "its picture", 100), "…and its picture appears when it is done");
  const log = await jobs();
  ok(log.length === 1 && log[0].prompt === "a keeper beside a lamp" && log[0].images.length === 1, "…and the job is recorded, with its prompt");
  ok(posted() === 1, "…without sending anything to ComfyUI again");

  // ---- left, and finished while away ----
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("a lamp in the rain");
  await queueButton.click();
  await until(() => posted() === 2, "the second job to be sent", 60);
  // Moving to another page within the app: the app's picture queue keeps the job going.
  await page.locator("summary[aria-label=Menu]").click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings$/);
  ok(await until(async () => (await jobs()).length === 2, "the job to be recorded while away", 60), "a job that finishes while another page is open is recorded");
  await page.goBack();
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok(await until(async () => (await tiles.count()) === 1, "its picture", 40), "…and coming back shows its picture with the new ones");
  ok((await jobs())[0].prompt === "a lamp in the rain", "…with the prompt it was made from");

  // ---- nothing is listed twice ----
  await page.reload();
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await new Promise((r) => setTimeout(r, 800));
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  ok((await jobs()).length === 2 && (await tiles.count()) === 2 && (await pendingTiles.count()) === 0, "another refresh records nothing again and lists each picture once");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
