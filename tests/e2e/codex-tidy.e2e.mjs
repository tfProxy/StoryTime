// "Tidy this entry" on the entry page: the AI (fake, scripted) renames facts onto the category list; the owner applies.
import { launch, useMockAi } from "./browser.mjs";
import { startFakeAi } from "../fakeAi.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const SHOT_DIR = process.env.SHOT_DIR; // optional: save screenshots of the panel here
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const story = await post("/api/stories", { title: "Tidy Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: [] } });
const root = story.chapter_id;
const entry = await post("/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character", aliases: [], content: "", always_include: false });
await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect: "Fur", text: "Russet fur." });
await post("/api/codex/facts", { anchor_chapter_id: root, entry_id: entry.entry_id, op: "set", aspect: "Temperament", text: "Calm." });

const ai = await startFakeAi({
  port: 3222,
  delay: 1,
  reply: (body) => {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
    if (system.startsWith("You tidy one entry of a story's codex")) {
      return JSON.stringify({
        changes: [
          { from: [1], aspect: "Skin", form: "", text: "Russet fur.", why: "Fur is filed under Skin" },
          { from: [2], aspect: "Personality", form: "", text: "Calm.", why: "Temperament is filed under Personality" },
        ],
      });
    }
    return "?";
  },
});
const mock = await useMockAi(BASE);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

try {
  await page.goto(`${BASE}/s/${story.story_id}/codex/${entry.entry_id}?at=${root}`);
  const aspects = () => page.locator(".entry-facts .ef-aspect").allInnerTexts();
  await page.locator(".entry-facts .ef-aspect", { hasText: /^Fur$/ }).waitFor();
  await page.getByRole("button", { name: "Tidy this entry…" }).click();
  await page.getByRole("button", { name: "Ask the AI" }).click();
  const panel = page.locator(".tidy-entry");
  await panel.getByRole("button", { name: "Apply 2 changes" }).waitFor();
  ok((await panel.locator(".tidy-change").count()) === 2, "the panel lists the two changes");
  ok((await panel.locator("del").first().innerText()).includes("Fur: Russet fur.") && (await panel.locator("ins").first().innerText()).includes("Skin: Russet fur."), "each change shows the fact before and after");
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/tidy-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll at phone width");
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/tidy-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1200, height: 900 });
  await panel.getByRole("button", { name: "Apply 2 changes" }).click();
  await panel.waitFor({ state: "detached" });
  await page.locator(".entry-facts .ef-aspect", { hasText: /^Skin$/ }).waitFor();
  const after = await aspects();
  ok(after.includes("Skin") && after.includes("Personality") && !after.includes("Fur") && !after.includes("Temperament"), "the facts now read Skin and Personality, not Fur: " + after.join(","));
} catch (e) {
  console.log("ERROR", e);
  failed = true;
}

await browser.close();
await ai.close();
await mock.restore();
process.exit(failed ? 1 : 0);
