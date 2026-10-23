// Temporary (Refine) picture jobs on the Illustrate page: left out of every view unless the author turns on
// "Include temporary inpainting images" (which only appears when there is one), shown anyway when pinned.
// Jobs are put in the log through the API; the pictures come from a fake ComfyUI.
import { launch } from "./browser.mjs";
import { startFakeComfy } from "./fakeComfy.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const COMFY_PORT = 3557;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });

let n = 0;
const job = (chapter_id, prompt, extra = {}) =>
  call("POST", "/api/picture-jobs", {
    chapter_id, prompt_id: `tmp${++n}-${Date.now()}`, prompt, negative: "", checkpoint: "fake_sdxl_a.safetensors", width: 1344, height: 768, seed: 500 + n, count: 1, moment: "start",
    images: [{ filename: `StoryTime_${n}_0.png`, subfolder: "", type: "output" }], ...extra,
  });
const mark = (j, value) => call("PUT", `/api/picture-jobs/${j.id}/mark`, { index: 0, mark: value });

// A story with two chapters: pictures for the first, the second to look at "Other chapters" from.
const story = await call("POST", "/api/stories", { title: "Temporary pictures tale", chapter: { title: "The studio", body: "Paint.", choices: ["Go on"] } });
const first = story.chapter_id;
const choice = (await call("GET", `/api/chapters/${first}`)).choices[0];
const second = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "The gallery", body: "Frames." })).chapter_id;
// A story with only ordinary pictures.
const plainStory = await call("POST", "/api/stories", { title: "Ordinary pictures tale", chapter: { title: "Plain", body: "Nothing special.", choices: [] } });

const keptPlain = await job(first, "a pinned ordinary picture");
await job(first, "an unpinned ordinary picture");
await job(first, "a temporary picture nobody kept", { temporary: true });
const keptTemp = await job(first, "a temporary picture that was pinned", { temporary: true });
const trashedTemp = await job(first, "a temporary picture that was trashed", { temporary: true });
await mark(keptPlain, "pinned");
await mark(keptTemp, "pinned");
await mark(trashedTemp, "rejected");
await job(plainStory.chapter_id, "only ordinary here");

const before = (await call("GET", "/api/settings")).settings;
const comfy = await startFakeComfy({ port: COMFY_PORT });
await putSettings({ ...(before ?? {}), comfy: { url: comfy.url, workflow: "", checkpoint: "", width: 1344, height: 768, count: 4 } });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const gallery = page.locator(".chapter-pictures");
const heads = () => gallery.locator(".picture-group .candidates").evaluateAll((uls) => uls.map((ul) => ul.getAttribute("aria-label").replace(/^Pictures from “/, "").replace(/”$/, "")));
const viewButton = (name) => gallery.getByRole("group", { name: "Show" }).getByRole("button", { name });
const showView = (name) => viewButton(name).click();
const toggle = gallery.getByRole("checkbox", { name: "Include temporary inpainting images" });
const open = async (id) => {
  await page.goto(`${BASE}/c/${id}/illustrate`);
  await gallery.getByRole("heading", { name: "Pictures" }).waitFor();
};

try {
  // ---- hidden by default ----
  await open(first);
  await toggle.waitFor();
  ok(await toggle.isChecked() === false, "the switch is off when the page opens");
  ok((await heads()).join("|") === "a temporary picture that was pinned|a pinned ordinary picture", "Pinned & new shows the pinned ordinary picture and the pinned temporary one, not the unpinned temporary one");
  ok(await viewButton("Pinned & new (2)").count() === 1 && await viewButton("All (3)").count() === 1 && await viewButton("Trashed (0)").count() === 1, "the counts leave temporary pictures out (2 pinned, 3 in All, none trashed)");
  await showView(/^All/);
  ok((await heads()).join("|") === "a temporary picture that was pinned|an unpinned ordinary picture|a pinned ordinary picture", "All shows the pinned temporary picture but not the others");
  await showView(/^Trashed/);
  await page.getByText("No trashed pictures.").waitFor();
  ok((await heads()).length === 0, "Trashed does not show the trashed temporary picture");

  // ---- the switch reveals them ----
  await toggle.check();
  await viewButton("Trashed (1)").waitFor();
  ok((await heads()).join("|") === "a temporary picture that was trashed", "with the switch on, Trashed shows the trashed temporary picture");
  await showView(/^All/);
  await viewButton("All (4)").waitFor();
  const all = await heads();
  ok(all.length === 4 && all.includes("a temporary picture nobody kept"), "All then has the unpinned temporary picture too");
  const tile = gallery.getByRole("list", { name: "Pictures from “a temporary picture nobody kept”", exact: true }).locator(".picture-tile");
  ok((await tile.locator(".picture-caption").innerText()).includes("temporary"), "a temporary picture's caption says temporary");
  ok(await gallery.getByRole("list", { name: "Pictures from “an unpinned ordinary picture”", exact: true }).locator(".picture-caption").first().innerText().then((t) => !t.includes("temporary")), "…and an ordinary one's does not");

  // ---- off again ----
  await toggle.uncheck();
  await viewButton("All (3)").waitFor();
  ok((await heads()).length === 3 && !(await heads()).includes("a temporary picture nobody kept"), "turning the switch off hides them again");

  // ---- Other chapters ----
  await open(second);
  await toggle.waitFor();
  await showView("Other chapters");
  const other = page.locator("#other-pictures");
  await other.locator(".past-job").first().waitFor();
  const names = () => other.locator(".past-tiles").evaluateAll((uls) => uls.map((ul) => ul.getAttribute("aria-label").replace(/^Pictures from “/, "").replace(/”$/, "")));
  ok((await names()).sort().join("|") === "a pinned ordinary picture|a temporary picture that was pinned|an unpinned ordinary picture", "Other chapters leaves out unpinned temporary pictures");
  await toggle.check();
  await page.waitForFunction(() => document.querySelectorAll("#other-pictures .past-job").length === 5);
  ok((await names()).includes("a temporary picture nobody kept") && (await names()).includes("a temporary picture that was trashed"), "…and lists them with the switch on");

  // ---- no temporary pictures: no switch ----
  await open(plainStory.chapter_id);
  await gallery.getByRole("group", { name: "Show" }).waitFor();
  await page.waitForTimeout(500);
  ok(await toggle.count() === 0, "a story with no temporary pictures has no switch");

  await page.setViewportSize({ width: 390, height: 900 });
  await open(first);
  await toggle.waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at phone width the page does not scroll sideways");
} finally {
  await putSettings(before ?? {});
  await browser.close();
  await comfy.close();
}
process.exit(failed ? 1 : 0);
