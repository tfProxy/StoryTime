// The codex while writing a new chapter on the writing desk: an entry's details changed "from this chapter" are held in
// the draft (saved by Post at the new chapter), while one put at an earlier chapter is saved at once. (The desk's
// other codex behaviour is in desk.e2e, desk-path.e2e and desk-text.e2e.)
import { launch } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const codexAt = async (id) => (await (await fetch(`${BASE}/api/chapters/${id}/codex`)).json()).entries;
const until = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

const story = await post("/api/stories", { title: "Codex Write", premise: "p", chapter: { title: "Root", body: "Mira stood there.", choices: ["Go on"] } });
const root = story.chapter_id;
const choice = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices[0];
await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Zed", type: "character", content: "" });
await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Qux", type: "character", content: "" });

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await unfoldEntryFolds(ctx);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
const draftKey = `fill:${choice.id}`;

try {
  await page.goto(`${BASE}/c/${root}/desk?choice=${choice.id}`);
  const box = page.locator("section.desk-box");
  await box.getByLabel("Chapter title").waitFor();
  const entryCol = page.locator("section.desk-entry");
  const editDetails = async (name) => {
    await page.locator("aside.desk-side .desk-row", { hasText: name }).click();
    await page.locator(`section.desk-entry[aria-label="Codex entry: ${name}"]`).waitFor();
    await entryCol.getByLabel("More entry actions").click();
    await entryCol.getByRole("button", { name: "Edit details" }).click();
    return entryCol.locator('section[aria-label="Name, type and keywords"]');
  };

  // From this chapter (the default on a new chapter): held in the draft.
  let details = await editDetails("Zed");
  ok((await details.getByRole("button", { name: "This chapter", exact: true }).getAttribute("aria-pressed")) === "true", "on a new chapter, “Takes effect from” starts on this chapter");
  ok(/Saved when you post it/.test(await details.locator(".chapter-picker-explain").innerText()), "…saved when the chapter is posted");
  await details.getByLabel(/^Keywords/).fill("the boatman");
  await details.getByRole("button", { name: "Save changes" }).click();
  const held = await until(async () => (await (await fetch(`${BASE}/api/drafts/${encodeURIComponent(draftKey)}`)).json()).draft?.codexChanges?.length === 1);
  ok(!!held && !(await codexAt(root)).find((e) => e.name === "Zed").aliases.includes("the boatman"), "the change is held in the draft, not saved");

  // At an earlier chapter: saved at once.
  details = await editDetails("Qux");
  await details.getByRole("button", { name: "Previous chapter (Root)" }).click();
  ok(/Saved now/.test(await details.locator(".chapter-picker-explain").innerText()), "an earlier chapter says it is saved now");
  await details.getByLabel(/^Keywords/).fill("the hermit");
  await details.getByRole("button", { name: "Save changes" }).click();
  ok(!!(await until(async () => (await codexAt(root)).find((e) => e.name === "Qux").aliases.join() === "the hermit")), "picking an earlier chapter saves straight away");

  // Post saves the held change at the new chapter.
  await box.getByLabel("Chapter text").fill("Zed rowed on.");
  await page.waitForFunction(() => /Draft saved/.test(document.querySelector("section.desk-box")?.textContent ?? ""));
  await box.getByRole("button", { name: "Post chapter" }).click();
  await page.waitForURL(/\/c\/[^/]+\/desk\?posted=1$/);
  const posted = new URL(page.url()).pathname.split("/")[2];
  ok((await codexAt(posted)).find((e) => e.name === "Zed").aliases.includes("the boatman"), "posting saves the held change at the new chapter");
  ok(!(await codexAt(root)).find((e) => e.name === "Zed").aliases.includes("the boatman"), "…and the chapter before it is unchanged");
} finally {
  await fetch(`${BASE}/api/drafts/${encodeURIComponent(draftKey)}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
