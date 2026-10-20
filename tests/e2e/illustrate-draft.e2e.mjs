// The Illustrate page remembers its prompt boxes per chapter, on the server: after a pause in typing, and
// straight away when the page is left (reloaded, or another page opened in the app) before that pause.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const until = async (fn, what, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};

const story = await call("POST", "/api/stories", { title: "Remembered prompts", chapter: { title: "First", body: "The keeper lit the lamp.", choices: ["Go on"] } });
const first = story.chapter_id;
const choice = (await call("GET", `/api/chapters/${first}`)).choices[0];
const second = (await call("POST", "/api/chapters", { choice_id: choice.id, title: "Second", body: "The storm came in." })).chapter_id;
const saved = async (id) => (await call("GET", `/api/chapters/${id}/picture-draft`)).draft;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const promptBox = page.getByRole("textbox", { name: "Prompt", exact: true });
const negativeBox = page.getByRole("textbox", { name: "Negative prompt", exact: true });
const showBox = page.getByLabel("What to show (optional)");
const momentMenu = page.getByLabel("Moment to show");
const open = async (id) => {
  await page.goto(`${BASE}/c/${id}/illustrate`);
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
};

try {
  // ---- typed, then saved after a pause ----
  await open(first);
  ok((await promptBox.inputValue()) === "" && (await momentMenu.inputValue()) === "start", "a chapter with nothing saved opens with empty boxes and Chapter start");
  await page.waitForTimeout(1200);
  ok((await saved(first)) === null, "…and opening it saves nothing");
  await promptBox.fill("a lighthouse at dusk, “gulls” – wide");
  await negativeBox.fill("blurry, text");
  await showBox.fill("the keeper at the lamp");
  await momentMenu.selectOption("end");
  ok(await until(async () => (await saved(first))?.moment === "end", "the boxes to be saved"), "the boxes are saved on the server a moment after typing stops");
  const d = await saved(first);
  ok(d.prompt === "a lighthouse at dusk, “gulls” – wide" && d.negative === "blurry, text" && d.direction === "the keeper at the lamp", "…the prompt, negative prompt and What to show, quotes and dashes intact");

  // ---- back on the page ----
  await open(first);
  ok((await promptBox.inputValue()) === "a lighthouse at dusk, “gulls” – wide" && (await negativeBox.inputValue()) === "blurry, text", "reopening the page brings back the prompt and negative prompt");
  ok((await showBox.inputValue()) === "the keeper at the lamp" && (await momentMenu.inputValue()) === "end", "…What to show, and the moment");
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await fresh.newPage();
  await phone.goto(`${BASE}/c/${first}/illustrate`);
  ok((await phone.getByRole("textbox", { name: "Prompt", exact: true }).inputValue()) === "a lighthouse at dusk, “gulls” – wide", "…in another browser too (it is kept on the server, not in the browser)");
  await fresh.close();

  // ---- each chapter has its own ----
  await open(second);
  ok((await promptBox.inputValue()) === "" && (await momentMenu.inputValue()) === "start", "another chapter has its own, empty, boxes");

  // ---- leaving before the pause is over ----
  await open(first);
  await promptBox.fill("changed just before a reload");
  await page.reload();
  await page.getByRole("heading", { name: "Picture prompt" }).waitFor();
  ok(await until(async () => (await saved(first))?.prompt === "changed just before a reload", "the change to be sent as the page went away"), "a change made just before reloading is still saved");
  await open(first);
  ok((await promptBox.inputValue()) === "changed just before a reload", "…and shows when the page opens again");
  await promptBox.fill("changed just before leaving");
  await page.getByRole("link", { name: "← Back to “First”" }).click();
  await page.waitForURL(`${BASE}/c/${first}`);
  ok(await until(async () => (await saved(first))?.prompt === "changed just before leaving", "the change to be sent on leaving"), "…and so is one made just before going back to the chapter");

  // ---- a save that fails says so ----
  await open(first);
  await page.route("**/picture-draft", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk full" }) }));
  await promptBox.fill("this one won't keep");
  await page.getByText("Couldn't keep the prompt for next time: disk full").waitFor();
  ok(true, "a save that fails says the prompt couldn't be kept, and why");
  await page.unroute("**/picture-draft");
  await promptBox.fill("this one will");
  await page.getByText("Couldn't keep the prompt for next time").waitFor({ state: "detached" });
  ok((await saved(first)).prompt === "this one will", "…and the message goes once a later save works");
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
