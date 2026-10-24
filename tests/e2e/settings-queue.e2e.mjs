// Settings › Queue: the defaults, saving each choice, and that settings saved before the section existed read as the defaults.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (url) => (await fetch(BASE + url)).json();
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const before = (await call("/api/settings")).settings;
// Settings from before the Queue section: no `queue` key at all.
const { queue: _queue, ...old } = before ?? {};
await putSettings(old);

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 400, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const saved = async () => (await call("/api/settings")).settings.queue;

try {
  await page.goto(`${BASE}/settings#queue`);
  const panel = page.locator("#panel-queue");
  await panel.waitFor();
  ok(await page.locator("#tab-queue").isVisible(), "Settings has a Queue tab");
  ok((await panel.innerText()).includes("Take turns when the AI model and ComfyUI run on the same machine, so they don't run out of memory."), "the line under Writing and pictures is shown");

  const turns = panel.getByLabel("Take turns (same machine)");
  const together = panel.getByLabel("At the same time (different machines)");
  const minutes = panel.getByLabel(/Switch after/);
  const items = panel.getByLabel(/and after/);
  const group = panel.getByLabel(/Group pictures by drawing preset/);
  ok(await turns.isChecked() && !(await together.isChecked()), "Take turns is the default");
  ok((await minutes.inputValue()) === "10" && (await items.inputValue()) === "0", "Switch after defaults to 10 minutes and no item limit");
  ok(await group.isChecked(), "grouping pictures is on by default");

  await minutes.fill("25");
  await minutes.blur();
  await items.fill("4");
  await items.blur();
  await group.uncheck();
  await until(async () => { const q = await saved(); return q?.switchMinutes === 25 && q?.switchItems === 4 && q?.groupPictures === false; }, "the numbers and checkbox to save");
  ok(true, "switch minutes, items and grouping are saved");

  await together.check();
  await until(async () => (await saved())?.sharing === "together", "At the same time to save");
  ok((await panel.getByLabel(/Switch after/).count()) === 0, "the switching numbers are hidden when running at the same time");

  await page.reload();
  await page.locator("#panel-queue").waitFor();
  ok(await page.locator("#panel-queue").getByLabel("At the same time (different machines)").isChecked(), "the choice is still there after a reload");

  await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR ?? "/tmp"}/settings-queue-400.png`, fullPage: true });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 400px the Queue tab does not scroll sideways");
} finally {
  await putSettings(before ?? {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
