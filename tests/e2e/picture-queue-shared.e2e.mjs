// A ComfyUI shared with another StoryTime and with other tools: the picture queue only picks up jobs that
// are this StoryTime's. Jobs another StoryTime queued (their chapters aren't here), jobs a tool made by
// copying a StoryTime job, and jobs for a chapter that doesn't exist are left alone: not shown being made,
// not listed as ready, no "couldn't record" warning, nothing recorded. This StoryTime's own jobs, with or
// without its id (from before jobs carried one), are still found.
import { comfySettings, launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3562;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Shared", chapter: { title: "The pier", body: "Waves.", choices: [] } });
const chapterId = story.chapter_id;
const storyId = story.story_id;
const me = (await call("GET", "/api/instance")).id;
ok(typeof me === "string" && me.length >= 8 && (await call("GET", "/api/instance")).id === me, "this StoryTime has an id, and it stays the same");

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT, steps: 4, stepDelay: 100, startDelay: 100 });
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: comfy.url, checkpoint: "fake_sdxl_a.safetensors", count: 1 }) });

// What a job's tag looks like (see src/lib/comfy/jobTag.ts).
const tag = (prompt, over = {}) => ({
  storytime: {
    chapterId, storyId, clientId: `storytime-${prompt.replace(/\W/g, "")}`,
    job: { prompt, negative: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, seed: 1, count: 1, moment: "start" },
    ...over,
  },
});
const other = "someone-elses-id";
// Another StoryTime on the same ComfyUI: its own chapter and instance id.
comfy.addJob({ extra: tag("other instance, done", { chapterId: "nope-chapter", storyId: "nope-story", instance: other }) });
comfy.addJob({ extra: tag("other instance, running", { chapterId: "nope-chapter", storyId: "nope-story", instance: other }), state: "running" });
// A tool that copied a StoryTime job's tag: it carries another instance's id but names a chapter that is here.
comfy.addJob({ extra: tag("copied by a tool", { instance: other }) });
// Jobs from before jobs carried an id, for a chapter that doesn't exist here.
comfy.addJob({ extra: tag("old, unknown chapter", { chapterId: "gone-chapter", storyId: "gone-story" }) });
// This StoryTime's own: with its id, and from before jobs had one.
comfy.addJob({ extra: tag("mine, with id", { instance: me }) });
comfy.addJob({ extra: tag("mine, before ids") });
comfy.addJob({ extra: tag("mine, running", { instance: me }), state: "running" });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const badge = page.locator(".site-header .picture-queue-button");
const panel = page.getByRole("region", { name: "Queue" });
const recorded = async () => (await call("GET", `/api/picture-jobs?chapter=${chapterId}`)).jobs.map((j) => j.prompt).sort();

try {
  // Open the app on a page that isn't Illustrate: the queue looks at ComfyUI for every chapter.
  await page.goto(`${BASE}/settings`);
  // Two finished jobs of this StoryTime's (recorded as new) and one running.
  ok(await until(async () => (await badge.getAttribute("aria-label").catch(() => "")) === "Pictures: 1 being made, 2 ready", "this StoryTime's own jobs to be found"), "only this StoryTime's own jobs are found: one being made, two ready");
  await badge.click();
  const rows = await panel.getByRole("listitem").count();
  ok(rows === 3, "…and the list holds just those three");
  ok((await panel.getByText(/couldn.t record|does not exist/i).count()) === 0, "…with no warning about recording");
  ok(JSON.stringify(await recorded()) === JSON.stringify(["mine, before ids", "mine, with id"]), "…and only they were recorded in the picture log");

  // Leave it a while and look again (the app coming back into view): nothing from the others turns up.
  await new Promise((r) => setTimeout(r, 1500));
  await page.reload();
  ok(await until(async () => (await badge.getAttribute("aria-label").catch(() => "")) === "Pictures: 1 being made, 2 ready", "the same after a reload"), "after a reload the same three, and no others, are listed");
  ok(JSON.stringify(await recorded()) === JSON.stringify(["mine, before ids", "mine, with id"]), "…and still nothing of the others is recorded");
  ok(!comfy.calls.some((c) => c.path === "/interrupt" || (c.path === "/queue" && c.method === "POST")), "…and nothing was cancelled in ComfyUI");

  // A job this StoryTime queues now carries its id.
  await page.goto(`${BASE}/c/${chapterId}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("fresh job");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await until(() => comfy.calls.some((c) => c.method === "POST" && c.path === "/prompt"), "the job to be sent", 60);
  const sent = comfy.calls.find((c) => c.method === "POST" && c.path === "/prompt").body;
  ok(sent?.extra_data?.storytime?.instance === me, "a job it queues carries its id in ComfyUI");
  ok(sent?.extra_data?.storytime?.chapterId === chapterId, "…and its chapter");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
