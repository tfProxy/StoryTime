// Drafts are kept on the server: the page's working state survives a reload, another browser
// picks the draft up, old browser-only drafts move over, and two tabs can't overwrite each other.
import http from "node:http";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content;
    let text = "# Generated\n\nGenerated text here.";
    if (system.includes("JSON array and nothing else")) {
      text = JSON.stringify([{ choice: "Climb the tower", direction: "She climbs." }, { choice: "Swim the moat", direction: "She swims." }]);
    } else if (system.includes("running summary")) {
      text = JSON.stringify({ summary: "S", story_so_far: "SF" });
    }
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

const settingsBefore = (await json("GET", "/api/settings")).settings;
await json("PUT", "/api/settings", { ...(settingsBefore ?? {}), connections: [{ id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } });

const story = await json("POST", "/api/stories", { title: "Drafty", premise: "p", chapter: { title: "Root", body: "Mira stood at the gate.", choices: ["Go in", "Turn back"] } });
const root = story.chapter_id;
const [goIn, turnBack] = (await json("GET", `/api/chapters/${root}`)).choices;
const writeUrl = `${BASE}/c/${root}/write?choice=${goIn.id}`;
const draftUrl = `/api/drafts/${encodeURIComponent(`fill:${goIn.id}`)}`;

const browser = await launch();
const watch = (page) => {
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  return page;
};

// ---- the page's working state survives a reload ----
const ctxA = await browser.newContext();
const page = watch(await ctxA.newPage());
await page.goto(writeUrl);
await page.getByRole("button", { name: "Suggest ideas" }).click();
await page.getByText("Climb the tower").waitFor();
await page.locator("select:has(option[value=long])").selectOption("long");
await page.getByLabel("Chapter text").fill("She looked up.");
await page.getByLabel("Instruction for the AI").fill("make it darker");
await page.waitForFunction(() => /Draft saved/.test(document.body.innerText));
await page.waitForTimeout(700); // the last change's save
let stored = (await json("GET", draftUrl)).draft;
ok(stored?.body === "She looked up." && stored.ideaPages?.[0]?.length === 2 && stored.length === "long" && stored.instruction === "make it darker", "the draft and its working state are saved on the server");

await page.reload();
// Brainstorm folds away once there is chapter text.
await page.locator("summary", { hasText: "Brainstorm" }).click();
await page.getByText("Climb the tower").waitFor();
ok(true, "brainstorm ideas are still there after a reload");
ok((await page.locator("select:has(option[value=long])").inputValue()) === "long", "…and the chapter length");
ok((await page.getByLabel("Instruction for the AI").inputValue()) === "make it darker", "…and the unsent instruction");

// ---- another browser picks it up ----
const ctxB = await browser.newContext();
const other = watch(await ctxB.newPage());
await other.goto(`${BASE}/drafts`);
await other.getByText(/Drafty: “Go in”/).waitFor();
ok(true, "the drafts list in another browser shows it");
await other.goto(writeUrl);
await other.locator("summary", { hasText: "Brainstorm" }).click();
await other.getByText("Climb the tower").waitFor();
ok((await other.getByLabel("Chapter text").inputValue()) === "She looked up.", "…and opens it with its text and ideas");

// ---- two tabs: a stale save is caught ----
await other.getByLabel("Chapter title").fill("From B");
await other.waitForFunction(() => /Draft saved/.test(document.body.innerText));
await other.waitForTimeout(700);
ok((await json("GET", draftUrl)).draft.title === "From B", "the second browser's change is saved");
await page.getByLabel("Chapter title").fill("From A");
await page.getByText(/changed in another tab or browser/).waitFor({ timeout: 5000 });
ok((await json("GET", draftUrl)).draft.title === "From B", "a save from the stale tab is refused, not written over the newer draft");
await page.getByLabel("Chapter title").fill("From A, more");
await page.waitForTimeout(900);
ok((await json("GET", draftUrl)).draft.title === "From B", "…and saving stays paused until a version is picked");
await page.getByRole("button", { name: "Load that version" }).click();
ok((await page.getByLabel("Chapter title").inputValue()) === "From B", "loading that version shows the newer draft");

// keeping this tab's copy instead
await other.getByLabel("Chapter title").fill("From B again");
await other.waitForTimeout(900);
await page.getByLabel("Chapter title").fill("Mine wins");
await page.getByRole("button", { name: "Keep this one" }).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "Keep this one" }).click();
await page.waitForTimeout(700);
ok((await json("GET", draftUrl)).draft.title === "Mine wins", "keeping this one saves it over the other");

// coming back to a tab after writing elsewhere shows the newer draft
await page.waitForTimeout(700);
await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await other.waitForFunction(() => document.querySelector("#field-title input")?.value === "Mine wins", null, { timeout: 5000 }).catch(() => {});
ok((await other.getByLabel("Chapter title").inputValue()) === "Mine wins", "returning to the other tab brings in the newer draft");

// posting deletes the draft
await other.getByRole("button", { name: "Post chapter" }).click();
await other.waitForURL(/\/c\/[^/]+\?posted=1/);
ok((await fetch(BASE + draftUrl)).status === 404, "posting removes the draft from the server");

// ---- drafts kept in the browser by older versions move to the server ----
const ctxC = await browser.newContext();
const old = watch(await ctxC.newPage());
await old.goto(`${BASE}/`);
await old.evaluate(async (d) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("storytime", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(d); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}, { key: `fill:${turnBack.id}`, href: `/c/${root}/write?choice=${turnBack.id}`, label: "Drafty: “Turn back”", updatedAt: Date.now() - 60_000, storyTitle: "", premise: "", newChoiceLabel: "Turn back", title: "Old local", body: "Written before the upgrade.", choices: [""], prompt: "", undo: [] });
await old.goto(`${BASE}/drafts`);
await old.getByText("Old local").waitFor();
ok(true, "an old browser-only draft shows in the drafts list");
const moved = (await json("GET", `/api/drafts/${encodeURIComponent(`fill:${turnBack.id}`)}`)).draft;
ok(moved?.body === "Written before the upgrade.", "…because it was moved to the server");
const leftLocal = await old.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === "storytime"));
ok(!leftLocal, "…and the browser's copy is cleared");
await json("DELETE", `/api/drafts/${encodeURIComponent(`fill:${turnBack.id}`)}`);

// ---- Discard draft: the post button's menu deletes the draft, after asking ----
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  const dialogs = [];
  let accept = false;
  p.on("dialog", (d) => { dialogs.push(d.message()); return accept ? d.accept() : d.dismiss(); });
  const discardUrl = `/api/drafts/${encodeURIComponent(`fill:${turnBack.id}`)}`;
  await p.goto(`${BASE}/c/${root}/write?choice=${turnBack.id}`);
  await p.getByLabel("Chapter text").fill("To be thrown away.");
  await p.waitForFunction(() => /Draft saved/.test(document.body.innerText));
  await p.waitForTimeout(700);
  ok((await json("GET", discardUrl)).draft?.body === "To be thrown away.", "a new draft is saved before discarding");
  const draftIcon = (pg) => pg.locator(".choice-unwritten", { hasText: "Turn back" }).locator(".choice-draft");
  const reader = await ctx.newPage();
  await reader.goto(`${BASE}/c/${root}`);
  ok((await draftIcon(reader).count()) === 1, "the reading page shows a draft icon on the choice with a saved draft");
  await reader.close();
  await p.getByRole("button", { name: "More ways to post" }).click();
  await p.getByRole("menuitemradio", { name: /^Discard draft/ }).click();
  const main = p.locator(".split-button > button").first();
  ok((await main.textContent()) === "Discard draft" && (await main.getAttribute("class"))?.includes("danger"), "choosing Discard draft turns the main button red");
  await main.click();
  await p.waitForTimeout(500);
  ok(dialogs.length === 1 && /can't be undone/.test(dialogs[0]), "it asks first: " + dialogs[0]);
  ok((await json("GET", discardUrl)).draft?.body === "To be thrown away.", "saying no keeps the draft");
  accept = true;
  await main.click();
  await p.waitForURL((u) => u.pathname === `/c/${root}`);
  ok(true, "saying yes goes back to the chapter above");
  await p.waitForTimeout(700);
  ok(!(await json("GET", discardUrl)).draft, "…and the draft is gone");
  await p.reload();
  ok((await draftIcon(p).count()) === 0, "…so the choice no longer shows the draft icon");
  await ctx.close();
}

await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
