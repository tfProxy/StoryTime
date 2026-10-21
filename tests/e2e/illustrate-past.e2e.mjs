// The Illustrate page's Pictures panel with pictures made earlier (from the job log): the views (Pinned & new,
// All, Trashed, Other chapters), pinning, trashing and restoring, what shows on return, a picture
// ComfyUI has lost, and using and loading pictures from it. Jobs are put in the log through the API; the
// pictures come from a fake ComfyUI.
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3556;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

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
const lanterns = [];
for (let i = 1; i <= 13; i++) lanterns.push(await job(second, `lantern glow number ${i}`, [`StoryTime_${i + 1}_0.png`]));
await job(second, "a picture ComfyUI has lost", ["Gone_9_0.png"]);
// one pinned and one rejected before the page opens
const mark = (j, index, value) => call("PUT", `/api/picture-jobs/${j.id}/mark`, { index, mark: value });
await mark(lanterns[3], 0, "pinned");
await mark(lanterns[5], 0, "rejected");
const marksOf = async () => (await call("GET", `/api/picture-jobs?chapter=${second}&limit=200`)).jobs.map((j) => `${j.prompt.replace("lantern glow number ", "#")}:${j.marks[0] ?? "-"}`);

const before = (await call("GET", "/api/settings")).settings;
await putSettings({ ...(before ?? {}), comfy: { url: "", workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 } });
const comfy = await startFakeComfy({ port: COMFY_PORT });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const gallery = page.locator(".chapter-pictures");
const tiles = gallery.locator(".candidates .picture-tile");
// Each run's prompt, newest first: runs have no heading, so it comes from the name of the run's list.
const heads = () => gallery.locator(".picture-group .candidates").evaluateAll((uls) => uls.map((ul) => ul.getAttribute("aria-label").replace(/^Pictures from “/, "").replace(/”$/, "")));
const viewButton = (name) => gallery.getByRole("group", { name: "Show" }).getByRole("button", { name });
const showView = async (name) => {
  await viewButton(name).click();
  ok(await viewButton(name).getAttribute("aria-pressed") === "true", `(showing ${name})`);
};
const tileFor = (prompt) => gallery.getByRole("list", { name: `Pictures from “${prompt}”`, exact: true }).locator(".picture-tile");
const other = page.locator("#other-pictures");
const exported = async () => (await call("GET", `/api/stories/${story.story_id}/export?format=json`)).images;
const open = async (id) => {
  await page.goto(`${BASE}/c/${id}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
};

try {
  // ---- no ComfyUI address: the pictures can't be shown ----
  await open(second);
  ok(await gallery.count() === 0, "with no ComfyUI address there is no Pictures panel");

  await putSettings({ ...(await call("GET", "/api/settings")).settings, comfy: { url: comfy.url, workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 } });
  await page.route(/\/view\?.*Gone_/, (route) => route.fulfill({ status: 404, body: "not found" }));
  await open(second);
  await gallery.getByRole("heading", { name: "Pictures" }).waitFor();

  // ---- on return: only the pinned ones ----
  ok(await viewButton(/^Pinned & new/).getAttribute("aria-pressed") === "true", "the Pictures panel opens on Pinned & new");
  ok(await tiles.count() === 1 && (await heads())[0] === "lantern glow number 4", "…which, on coming back, shows only the pinned picture");
  ok(await tiles.first().getByRole("button", { name: "Unpin" }).getAttribute("aria-pressed") === "true" && (await tiles.first().getAttribute("class")).includes("pinned"), "…marked as pinned");
  ok(await viewButton("Pinned & new (1)").count() === 1 && await viewButton("All (13)").count() === 1 && await viewButton("Trashed (1)").count() === 1, "the views count their pictures: 1 pinned, 13 not trashed, 1 trashed");
  ok(await gallery.getByRole("button", { name: "Clear unpinned" }).count() === 0, "there is nothing to clear on return");

  // ---- All: every picture but the rejected, grouped by prompt, newest first ----
  await showView(/^All/);
  await tiles.nth(12).waitFor();
  const all = await heads();
  ok(all.length === 13 && all[0] === "a picture ComfyUI has lost" && all[1] === "lantern glow number 13" && !all.includes("lantern glow number 6"), "All lists the 13 pictures not rejected, each under its prompt, newest first");
  ok(!all.includes("a cellar stair, dim light"), "…only this chapter's");
  ok((await tileFor("lantern glow number 13").locator(".picture-caption").innerText()) === "fake_sdxl_a · 1344 × 768", "each picture shows its checkpoint and size, not its seed");

  // ---- the order: newest first, or oldest first ----
  const order = gallery.locator(".picture-order");
  ok((await order.innerText()).includes("Newest first") && await order.getAttribute("aria-label") === "Order: newest first. Switch to oldest first", "the order button says the pictures are newest first");
  await order.click();
  ok(await until(async () => (await heads())[0] === "lantern glow number 1", "the order to change"), "Oldest first puts the oldest run at the top…");
  const oldest = await heads();
  ok(oldest.length === 13 && oldest[12] === "a picture ComfyUI has lost" && (await order.innerText()).includes("Oldest first"), "…and the newest at the bottom, and the button says so");
  ok((await call("GET", "/api/settings")).settings.comfy.picturesOldestFirst === true, "…the choice is kept in Settings, so it is the same on every device");
  await page.reload();
  await gallery.getByRole("heading", { name: "Pictures" }).waitFor();
  await showView(/^All/);
  await tiles.nth(12).waitFor();
  ok((await heads())[0] === "lantern glow number 1", "…and is still oldest first after a reload");
  await gallery.locator(".picture-order").click();
  ok(await until(async () => (await heads())[0] === "a picture ComfyUI has lost", "newest first again"), "Clicking again goes back to newest first");

  // ---- a picture ComfyUI no longer has ----
  const gone = tileFor("a picture ComfyUI has lost");
  await gone.getByText("ComfyUI no longer has this picture").waitFor();
  await gone.getByRole("button", { name: "More" }).click();
  ok((await gone.getByRole("menuitem").allInnerTexts()).join("|") === "Load prompt|Info" && await gone.getByRole("button", { name: "Trash" }).isEnabled(), "a picture ComfyUI has lost says so and can't be used (its menu only has Load prompt and Info), but can be trashed");
  await page.keyboard.press("Escape");

  // ---- pin ----
  const thirteen = tileFor("lantern glow number 13");
  await thirteen.getByRole("button", { name: "Pin" }).click();
  ok(await until(async () => (await marksOf()).includes("#13:pinned"), "the pin to be saved"), "Pin saves the mark");
  ok(await viewButton("Pinned & new (2)").count() === 1, "…and Pinned & new counts it");
  ok(await gallery.locator("p.ok").count() === 0 && await gallery.getByRole("button", { name: "Undo" }).count() === 0, "…without a message or an Undo button");

  // ---- trash ----
  ok((await gone.getByRole("button", { name: "Trash" }).innerHTML()).includes("<svg"), "the Trash button shows a trash can");
  await gone.getByRole("button", { name: "Trash" }).click();
  ok(await until(async () => (await marksOf())[0] === "a picture ComfyUI has lost:rejected", "the trash to be saved"), "Trash saves the mark");
  ok(await tileFor("a picture ComfyUI has lost").count() === 0 && await viewButton("All (12)").count() === 1 && await viewButton("Trashed (2)").count() === 1, "…hides the picture from All and counts it under Trashed");
  ok(await gallery.locator("p.ok").count() === 0, "…without a message");

  // ---- Trashed: restore ----
  await showView(/^Trashed/);
  ok(await tiles.count() === 2 && (await heads()).includes("lantern glow number 6"), "Trashed shows the trashed pictures");
  ok((await tiles.first().getAttribute("class")).includes("rejected"), "…dimmed");
  await tileFor("a picture ComfyUI has lost").getByRole("button", { name: "Restore" }).click();
  await until(async () => (await tiles.count()) === 1, "the first restore");
  await tileFor("lantern glow number 6").getByRole("button", { name: "Restore" }).click();
  await gallery.getByText("No trashed pictures.").waitFor();
  ok(await tiles.count() === 0, "Restore takes them out of Trashed");
  ok(await until(async () => (await marksOf()).includes("#6:-") && (await marksOf())[0] === "a picture ComfyUI has lost:-", "the restores to be saved"), "…and clears their marks");
  await showView(/^All/);
  ok(await viewButton("All (14)").count() === 1 && await tileFor("lantern glow number 6").count() === 1, "…and it is back under All");

  // ---- use one and load its prompt ----
  await thirteen.getByRole("button", { name: "More" }).click();
  await thirteen.getByRole("menuitem", { name: "Use as header picture" }).click();
  await gallery.getByText("Saved as the header picture.").waitFor();
  const header = (await exported()).find((i) => i.slot === "header" && i.chapter_id === second);
  ok(header?.prompt === "lantern glow number 13", `using an earlier picture saves it as the header, with the prompt that made it (${header?.prompt})`);
  await thirteen.locator(".picture-in-use").waitFor();
  ok((await thirteen.locator(".picture-in-use").innerText()).trim() === "Header", "…and it is marked as the header");
  await thirteen.getByRole("button", { name: "More" }).click();
  await thirteen.getByRole("menuitem", { name: "Load prompt" }).click();
  const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
  await page.getByText("Reuse seed").waitFor();
  ok(await promptBox.inputValue() === "lantern glow number 13" && await page.getByRole("textbox", { name: "Negative prompt", exact: true }).inputValue() === "neg 14", "Load prompt fills in the prompt and the negative prompt");
  ok(await page.getByText(`Reuse seed ${1000 + 14}`).isVisible(), "…and offers to reuse its seed");
  ok(await page.getByText("The loaded picture was made with").count() === 0, "…and doesn't offer to change the checkpoint it was made with: that is the story's, set on its details page");

  // ---- back again: the two pinned ones; unpinning one there hides it ----
  await open(second);
  await tiles.nth(1).waitFor();
  ok(JSON.stringify(await heads()) === JSON.stringify(["lantern glow number 13", "lantern glow number 4"]), "coming back shows the two pinned pictures");
  await tileFor("lantern glow number 4").getByRole("button", { name: "Unpin" }).click();
  await until(async () => (await tiles.count()) === 1, "the picture to be unpinned");
  ok(await tiles.count() === 1 && await viewButton("Pinned & new (1)").count() === 1, "unpinning an earlier picture takes it out of Pinned & new (it is under All)");
  await showView(/^All/);
  await tileFor("lantern glow number 4").getByRole("button", { name: "Pin" }).click();
  await showView(/^Pinned/);
  ok(await until(async () => (await tiles.count()) === 2, "the picture to be pinned again"), "…and pinning it under All brings it back");

  // ---- a mark that can't be saved ----
  await page.route("**/mark", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk full" }) }));
  await tileFor("lantern glow number 4").getByRole("button", { name: "Trash" }).click();
  await gallery.getByText("Couldn't change the mark: disk full").waitFor();
  ok(await tiles.count() === 2 && await tileFor("lantern glow number 4").getByRole("button", { name: "Unpin" }).count() === 1, "a mark the server refuses is put back, and the page says why");
  await page.unroute("**/mark");

  // ---- other chapters ----
  await showView("Other chapters");
  await other.locator(".past-job").first().waitFor();
  ok(await other.locator("h3").allInnerTexts().then((h) => h.length === 1 && h[0] === "The cellar"), "Other chapters lists the story's other chapters under their titles, not this one");
  ok(await other.locator(".past-job img").count() === 2, "…with their pictures");
  ok(!(await other.locator(".past-job").first().innerText()).includes("a cellar stair") && await other.getByRole("button", { name: "Load prompt" }).count() === 0, "…and no prompt or Load prompt button above each job");
  const otherTile = other.locator(".picture-tile").first();
  await otherTile.getByRole("button", { name: "More" }).click();
  await otherTile.getByRole("menuitem", { name: "Info" }).click();
  const info = page.getByRole("dialog", { name: "Picture info" });
  ok((await info.innerText()).includes("a cellar stair, dim light") && (await info.innerText()).includes("“The cellar”"), "Info on another chapter's picture shows its prompt and the chapter it was made for");
  await info.getByRole("button", { name: "Close" }).click();
  await info.waitFor({ state: "detached" });
  await otherTile.getByRole("button", { name: "More" }).click();
  await otherTile.getByRole("menuitem", { name: "Use as footer picture" }).click();
  await gallery.getByText("Saved as the footer picture.").waitFor();
  const footer = (await exported()).find((i) => i.slot === "footer" && i.chapter_id === second);
  ok(footer?.prompt === "a cellar stair, dim light", "a picture made for another chapter can be saved here, and keeps its prompt");
  ok(!(await exported()).some((i) => i.chapter_id === first), "…and nothing was saved to the chapter it was made for");

  // ---- the first chapter: its own pictures, and the other chapter's a page at a time ----
  await open(first);
  await gallery.getByRole("heading", { name: "Pictures" }).waitFor();
  // The picture made here that was saved as the other chapter's footer was pinned when it was chosen.
  await tiles.first().waitFor();
  ok(await tiles.count() === 1 && await viewButton("Pinned & new (1)").count() === 1, "a picture of this chapter used as another chapter's footer is pinned here");
  await tiles.first().getByRole("button", { name: "Unpin" }).click();
  await gallery.getByText("No pinned pictures. The ones made earlier are under All (2).").waitFor();
  ok(await tiles.count() === 0, "a chapter with no pinned pictures says where the earlier ones are");
  await showView("Other chapters");
  await other.locator(".past-job").first().waitFor();
  ok(await other.locator(".past-job").count() === 12, "Other chapters shows 12 jobs at first");
  await other.getByRole("button", { name: "Show more" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#other-pictures .past-job").length === 14);
  ok(await other.getByRole("button", { name: "Show more" }).count() === 0, "Show more adds the last 2 and then goes away");

  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-past-1000.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await open(second);
  await showView(/^All/);
  await tiles.nth(12).waitFor();
  await page.waitForTimeout(300);
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/illustrate-past-390.png`, fullPage: true });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!wide, "at phone width the page does not scroll sideways");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
