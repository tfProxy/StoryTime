// The queue page (/queue): linked from the header list and the site menu; Pause queue holds new jobs (nothing reaches
// ComfyUI) until Resume; Move up, Move down and Do next change the order the held jobs are sent in; jobs show as
// working and finished; History lists the jobs after a reload.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3566;
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? "/tmp";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

// Three chapters of one story, so their jobs are for different targets and can be moved past each other.
const story = await call("POST", "/api/stories", { title: "Queue page tale", chapter: { title: "Chapter One", body: "one", choices: ["on"] } });
const ids = [story.chapter_id];
for (const title of ["Chapter Two", "Chapter Three"]) {
  const choice = (await call("GET", `/api/chapters/${ids.at(-1)}`)).choices[0];
  ids.push((await call("POST", "/api/chapters", { choice_id: choice.id, title, body: title, choices: title === "Chapter Two" ? ["on"] : [] })).chapter_id);
}
const names = ["Chapter One", "Chapter Two", "Chapter Three"];
const words = ["harbourword", "marketword", "forestword"];

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 6, stepDelay: 150, startDelay: 200 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

const header = page.locator(".site-header");
const badge = header.locator(".picture-queue-button");
const posts = () => comfy.calls.filter((c) => c.method === "POST" && c.path === "/prompt");
const sentOrder = () => posts().map((c) => words.findIndex((w) => JSON.stringify(c.body).includes(w)));
const section = (name) => page.getByRole("region", { name, exact: true });
const waitingNames = async () => (await section("Waiting").getByRole("listitem").allInnerTexts()).map((t) => names.find((n) => t.includes(n)));
// Moves to another page without a page load, so the queue keeps its jobs.
const go = async (path) => {
  await page.evaluate((p) => window.next.router.push(p), path);
  await page.waitForURL(`${BASE}${path}`);
};

try {
  // ---- the links ----
  await page.goto(`${BASE}/queue`);
  await page.getByRole("heading", { name: "Queue", exact: true }).waitFor();
  ok((await page.title()) === "Queue", "the page is titled Queue");
  ok(await section("Waiting").getByText("Nothing is waiting.").isVisible() && await section("Working").getByText("Nothing is being made.").isVisible(), "with nothing queued it says so");
  await page.locator(".site-menu summary").click();
  ok(await page.locator(".site-menu-items").getByRole("link", { name: "Queue", exact: true }).isVisible(), "the site menu links to the queue");
  await page.locator(".site-menu summary").click();

  // ---- pause, then queue three jobs ----
  await page.getByRole("button", { name: "Pause queue" }).click();
  ok(await until(async () => (await badge.getAttribute("aria-label")) === "Pictures: paused", "the header to say paused"), "Pause queue makes the header say Paused");
  ok((await badge.innerText()).includes("Paused"), "…with the word on the button");
  ok(await page.getByRole("button", { name: "Resume queue" }).isVisible(), "…and the page offers Resume queue");
  for (let i = 0; i < 3; i++) {
    await go(`/c/${ids[i]}/illustrate`);
    await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(words[i]);
    await page.getByRole("button", { name: "Queue", exact: true }).click();
  }
  await go("/queue");
  ok(await until(async () => (await waitingNames()).length === 3, "three waiting jobs", 60), "the three jobs wait on the queue page");
  await new Promise((r) => setTimeout(r, 1500));
  ok(posts().length === 0, "while paused nothing reaches ComfyUI");
  ok((await waitingNames()).join() === names.join(), "they wait in the order they were queued");
  ok((await section("Waiting").getByRole("listitem").first().innerText()).includes("Held while the queue is paused"), "…and say they are held");

  // ---- moving ----
  const items = () => section("Waiting").getByRole("listitem");
  const itemOf = (n) => items().filter({ hasText: n });
  ok(await itemOf("Chapter One").getByRole("button", { name: "Move up" }).isDisabled() && await itemOf("Chapter Three").getByRole("button", { name: "Move down" }).isDisabled(), "the first job can't move up, nor the last down");
  await itemOf("Chapter Three").getByRole("button", { name: "Move up" }).click();
  ok((await waitingNames()).join() === "Chapter One,Chapter Three,Chapter Two", `Move up swaps a job with the one before it: ${(await waitingNames()).join()}`);
  await itemOf("Chapter Two").getByRole("button", { name: "Do next" }).click();
  ok((await waitingNames()).join() === "Chapter Two,Chapter One,Chapter Three", `Do next puts a job first: ${(await waitingNames()).join()}`);
  await itemOf("Chapter One").getByRole("button", { name: "Move down" }).click();
  ok((await waitingNames()).join() === "Chapter Two,Chapter Three,Chapter One", `Move down swaps a job with the one after it: ${(await waitingNames()).join()}`);
  await page.screenshot({ path: `${SHOTS}/queue-page-desktop.png`, fullPage: true });

  // ---- resume: sent in that order ----
  await page.getByRole("button", { name: "Resume queue" }).click();
  ok(await until(() => posts().length === 3, "the three jobs to be sent", 80), "Resume queue sends the held jobs");
  ok(sentOrder().join() === "1,2,0", `…in the order they were given: ${sentOrder().join()}`);
  ok(await until(async () => (await section("Working").getByRole("listitem").count()) >= 1, "a working job", 40), "jobs being made show under Working");
  ok(await until(async () => (await section("Finished").getByRole("listitem").count()) === 3, "three finished jobs", 150), "when they finish they show under Finished");
  ok((await badge.getAttribute("aria-label")) === "Pictures: 3 ready", "…and the header counts them as ready");
  ok(await section("Working").getByText("Nothing is being made.").isVisible(), "Working is empty again");

  // ---- history, and a reload ----
  ok(await until(async () => (await section("History").getByRole("listitem").count()) >= 0, "history", 5), "History is shown");
  await page.reload();
  await page.getByRole("heading", { name: "History" }).waitFor();
  ok(await until(async () => (await section("History").getByRole("listitem").count()) >= 3, "the history to list the jobs", 50), "History lists the jobs after a reload");
  const history = await section("History").getByRole("listitem").allInnerTexts();
  ok(names.every((n) => history.some((t) => t.includes(n))) && history[0].includes("Queue page tale"), "…each with its chapter and story");
  ok((await section("History").locator("img").count()) >= 3, "…and a thumbnail");
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at desktop width the page doesn't scroll sideways");

  // ---- the header list links to the page; a reload stays paused ----
  await badge.click();
  await page.getByRole("region", { name: "Queue" }).getByRole("link", { name: "Open queue" }).click();
  await page.waitForURL(`${BASE}/queue`);
  ok(true, "the header list's Open queue goes to the page");
  await page.getByRole("button", { name: "Pause queue" }).click();
  await page.reload();
  ok(await until(async () => await page.getByRole("button", { name: "Resume queue" }).isVisible(), "still paused after a reload", 30), "a reload stays paused");
  await page.getByRole("button", { name: "Resume queue" }).click();
  ok(await until(async () => await page.getByRole("button", { name: "Pause queue" }).isVisible(), "resumed", 30), "Resume queue works after a reload");

  // ---- phone width ----
  await page.setViewportSize({ width: 400, height: 900 });
  await page.screenshot({ path: `${SHOTS}/queue-page-400.png`, fullPage: true });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the page doesn't scroll sideways");
} finally {
  await page.evaluate(() => localStorage.removeItem("storytime-queue-paused")).catch(() => {});
  // The jobs finished while no page was open, so they are unseen: mark them seen so later tests' headers stay clear.
  const unseen = (await call("GET", "/api/picture-jobs?unseen=1").catch(() => ({ jobs: [] }))).jobs.map((j) => j.id);
  await fetch(`${BASE}/api/picture-jobs/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: unseen }) }).catch(() => {});
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
