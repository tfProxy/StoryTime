// The picture queue in the header: a job asked for on a chapter's Illustrate page goes on when the author
// moves to another page, the header shows it being made (and the tab's title counts it), then says it is
// ready; its list links back to the chapter, where its pictures show with the new ones. Stop works from the list.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3561;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Queue tale", chapter: { title: "The harbour", body: "Boats came in.", choices: [] } });
const chapterId = story.chapter_id;
const before = (await call("GET", "/api/settings")).settings;
// Slow enough to move to another page while the job is being made.
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 10, stepDelay: 200, startDelay: 200 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const header = page.locator(".site-header");
const badge = header.locator(".picture-queue-button");
const panel = page.getByRole("region", { name: "Picture jobs" });
const tiles = page.locator(".candidates li.picture-tile");
const posted = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt").length;
const toStoryList = async () => {
  await header.getByRole("link", { name: "StoryTime", exact: true }).click();
  await page.waitForURL(`${BASE}/`);
};

try {
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok((await badge.count()) === 0, "with nothing queued the header shows no picture queue");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("boats in a harbour");

  // ---- queued, then away ----
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => posted() === 1, "the job to be sent to ComfyUI", 60);
  ok(await until(async () => (await badge.getAttribute("aria-label")) === "Pictures: 1 being made", "the header to show the job"), "the header shows the job being made");
  ok(await until(async () => (await page.title()) === "StoryTime (1)", "the tab title"), "…and the tab's title says StoryTime (1)");
  await toStoryList();
  ok((await badge.getAttribute("aria-label")) === "Pictures: 1 being made", "on another page the job is still shown being made");
  await badge.click();
  ok(await panel.getByRole("listitem", { name: "The harbour: being made" }).isVisible(), "its list names the chapter, being made");
  ok((await panel.getByText("Queue tale · Chapter start").count()) === 1, "…with the story and the moment");
  ok(await until(async () => (await badge.getAttribute("aria-label")) === "Pictures: 1 ready", "the job to finish", 100), "when it finishes the header says it is ready");
  ok((await page.title()) === "StoryTime", "…and the tab's title loses the count");
  const row = panel.getByRole("listitem", { name: "The harbour: ready" });
  ok((await row.locator("img").count()) === 1, "the list shows its picture");
  ok((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 1, "…and the job was recorded while away");

  // ---- back to the chapter ----
  await row.getByRole("link", { name: "Open", exact: true }).click();
  await page.waitForURL(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok(await until(async () => (await tiles.count()) === 1, "the picture on the chapter's page"), "Open goes to the chapter, where the picture shows with the new ones");
  ok(await until(async () => (await badge.count()) === 0, "the header to clear"), "…and the header no longer lists it");

  // ---- made while the chapter's page is open: never \"ready\" in the header ----
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => posted() === 2, "the second job to be sent", 60);
  ok(await until(async () => (await tiles.count()) === 2, "the second picture", 100), "a job finishing on its own chapter's page shows there");
  ok((await badge.count()) === 0, "…and isn't listed as ready in the header");

  // ---- Stop from the list ----
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => posted() === 3, "the third job to be sent", 60);
  await toStoryList();
  await badge.click();
  await panel.getByRole("button", { name: "Stop" }).click();
  ok(await until(async () => (await badge.count()) === 0, "the stopped job to go"), "Stop in the list stops the job and takes it off");
  ok(comfy.calls.some((c) => c.path === "/interrupt" || (c.path === "/queue" && c.method === "POST")), "…and tells ComfyUI");
  await new Promise((r) => setTimeout(r, 2500));
  ok((await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.length === 2, "…and nothing is recorded for it");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
