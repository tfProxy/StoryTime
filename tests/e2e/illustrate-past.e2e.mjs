// The Past pictures section of the Illustrate page: pictures made earlier (from the job log), for this chapter
// or the whole story grouped by chapter, paged, with Load prompt, Use as header/footer, and a picture ComfyUI
// has lost. Jobs are put in the log through the API; the pictures come from a fake ComfyUI.
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3556;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });

// A first chapter and the one after it; pictures are logged for both, the later chapter's last.
const story = await call("POST", "/api/stories", { title: "Past pictures tale", chapter: { title: "The cellar", body: "Mara went down.", choices: ["Go on"] } });
const first = story.chapter_id;
const choice = (await call("GET", `/api/chapters/${first}`)).choices[0];
const second = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "The lantern", body: "It glowed." })).chapter_id;
let n = 0;
const job = (chapter_id, prompt, files, extra = {}) =>
  call("POST", "/api/picture-jobs", {
    chapter_id, prompt_id: `p${++n}`, prompt, negative: `neg ${n}`, checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, seed: 1000 + n, count: files.length, moment: "start",
    images: files.map((filename) => ({ filename, subfolder: "", type: "output" })), ...extra,
  });
await job(first, "a cellar stair, dim light", ["StoryTime_1_0.png", "StoryTime_1_1.png"]);
for (let i = 1; i <= 13; i++) await job(second, `lantern glow number ${i}`, [`StoryTime_${i + 1}_0.png`]);
const lost = await job(second, "a picture ComfyUI has lost", ["Gone_9_0.png"]);

const before = (await call("GET", "/api/settings")).settings;
await putSettings({ ...(before ?? {}), comfy: { url: "", workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 } });
const comfy = await startFakeComfy({ port: COMFY_PORT });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const past = page.locator("#past-pictures");
const jobs = past.locator(".past-job");
const exported = async () => (await call("GET", `/api/stories/${story.story_id}/export?format=json`)).images;

try {
  // ---- no ComfyUI address: the pictures can't be shown ----
  await page.goto(`${BASE}/c/${second}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok(await past.count() === 0, "with no ComfyUI address there is no Past pictures section");

  await putSettings({ ...(await call("GET", "/api/settings")).settings, comfy: { url: comfy.url, workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 } });
  await page.route(/\/view\?.*Gone_/, (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto(`${BASE}/c/${second}/illustrate`);
  await past.getByRole("heading", { name: "Past pictures" }).waitFor();
  await jobs.first().waitFor();

  // ---- this chapter, newest first, paged ----
  ok(await past.getByRole("button", { name: "This chapter" }).getAttribute("aria-pressed") === "true", "Past pictures opens on this chapter");
  ok(await jobs.count() === 12, "the first page has 12 jobs");
  ok((await jobs.first().innerText()).startsWith("a picture ComfyUI has lost"), "…newest first");
  ok(await past.locator("h3").count() === 0, "…with no chapter headings, as they all belong to this chapter");
  await past.getByRole("button", { name: "Show more" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#past-pictures .past-job").length === 14);
  ok(await past.getByRole("button", { name: "Show more" }).count() === 0, "Show more adds the last 2 jobs and then goes away");
  ok(!(await past.innerText()).includes("cellar stair"), "…and the other chapter's picture is not listed");
  const meta = await jobs.nth(1).innerText();
  ok(meta.includes("fake_sdxl_a.safetensors") && meta.includes("1344 × 768") && meta.includes(`seed ${1000 + 14}`), "each job shows its checkpoint, size and seed");

  // ---- a picture ComfyUI no longer has ----
  const gone = jobs.first();
  await gone.getByText("ComfyUI no longer has this picture").waitFor();
  ok(await gone.getByRole("button", { name: "Use as header picture" }).isDisabled(), "a picture ComfyUI has lost says so and can't be used");
  const good = jobs.nth(1);
  await good.locator("img").waitFor();
  ok(await good.getByRole("button", { name: "Use as header picture" }).isEnabled(), "…while the others can");

  // ---- use one ----
  await good.getByRole("button", { name: "Use as header picture" }).click();
  await past.getByText("Saved as the header picture.").waitFor();
  const header = (await exported()).find((i) => i.slot === "header" && i.chapter_id === second);
  ok(header?.prompt === "lantern glow number 13", `using a past picture saves it as the header, with the prompt that made it (${header?.prompt})`);

  // ---- load its prompt ----
  await good.getByRole("button", { name: "Load prompt" }).click();
  const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
  await page.getByText("Reuse seed").waitFor();
  ok(await promptBox.inputValue() === "lantern glow number 13" && await page.getByRole("textbox", { name: "Negative prompt", exact: true }).inputValue() === "neg 14", "Load prompt fills in the prompt and the negative prompt");
  ok(await page.getByText(`Reuse seed ${1000 + 14}`).isVisible(), "…and offers to reuse its seed");

  // ---- this story: grouped by chapter ----
  await past.getByRole("button", { name: "This story" }).click();
  await past.locator("h3").first().waitFor();
  ok((await past.locator("h3").first().innerText()).startsWith("The lantern") && (await past.locator("h3").first().innerText()).includes("(this chapter)"), "the whole story groups pictures under their chapter's title, this chapter marked");
  await past.getByRole("button", { name: "Show more" }).click();
  await past.locator("h3", { hasText: "The cellar" }).waitFor();
  ok(await past.locator(".past-group", { hasText: "The cellar" }).locator(".past-job img").count() === 2, "…and the other chapter's two pictures are listed under its own title");

  // ---- use a picture made for another chapter ----
  const other = past.locator(".past-group", { hasText: "The cellar" }).locator(".past-job");
  await other.getByRole("button", { name: "Use as footer picture" }).first().click();
  await past.getByText("Saved as the footer picture.").waitFor();
  const footer = (await exported()).find((i) => i.slot === "footer" && i.chapter_id === second);
  ok(footer?.prompt === "a cellar stair, dim light", "a picture made for another chapter can be saved here, and keeps its prompt");
  ok(!(await exported()).some((i) => i.chapter_id === first), "…and nothing was saved to the chapter it was made for");

  // ---- an empty chapter ----
  await page.goto(`${BASE}/c/${first}/illustrate`);
  await past.locator(".past-job").first().waitFor();
  ok(await past.locator(".past-job").count() === 1, "the first chapter lists its own single job");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await past.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-past-1000.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${BASE}/c/${second}/illustrate`);
    await past.locator(".past-job").first().waitFor();
    await past.getByRole("button", { name: "This story" }).click();
    await past.locator("h3").first().waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-past-390.png`, fullPage: true });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!wide, "at phone width the page does not scroll sideways");
  }
  void lost;
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
