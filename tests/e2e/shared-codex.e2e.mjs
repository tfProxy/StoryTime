import { launch, useMockAi } from "./browser.mjs";

// The shared codex: the library page (add an entry, its details and facts), adding a shared entry to a story from a
// chapter on its codex page, and what the story's entry page shows for it.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE);
const browser = await launch();
const made = [];
try {
  // A story: Root -> Chapter A.
  const story = await post("/api/stories", { title: "Shared Tale", premise: "p", chapter: { title: "Root", body: "It began.", choices: ["Go to A"] } });
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Onward.", choices: [] })).chapter_id;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());

  // ---- the ☰ menu leads to the library ----
  await page.goto(`${BASE}/`);
  await page.locator(".site-menu summary").click();
  await page.locator(".site-menu a", { hasText: "Shared codex" }).click();
  await page.getByRole("heading", { name: "Shared codex", level: 1 }).waitFor();
  ok(page.url() === `${BASE}/shared`, "the menu opens the Shared codex");

  // ---- make an entry, give it details and a fact ----
  await page.getByRole("button", { name: "+ New shared entry" }).click();
  await page.getByLabel("Name").fill("Mara Vale");
  await page.getByRole("button", { name: "Add entry" }).click();
  await page.getByRole("heading", { name: "Mara Vale", level: 1 }).waitFor();
  const sharedUrl = page.url();
  made.push(sharedUrl.split("/").pop());
  const sid = made[0];
  await page.getByLabel("Keywords").fill("Mara, the fox");
  await page.getByLabel("Your notes (not sent to the AI)").fill("Base notes.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  await page.getByRole("button", { name: "+ Add fact" }).click();
  await page.getByLabel("Aspect").fill("Ears");
  await page.getByLabel("Text").fill("tall russet fox ears");
  await page.getByRole("button", { name: "Save fact" }).click();
  await page.getByText("tall russet fox ears").waitFor();
  ok((await send("GET", `/api/shared/${sid}`)).entry.aliases.join() === "Mara,the fox", "the details are saved");

  // ---- add it to the story from Chapter A ----
  await page.goto(`${BASE}/c/${A}/codex`);
  await page.getByRole("button", { name: "+ Shared entry" }).click();
  await page.getByLabel("Appears from").selectOption(A);
  await page.getByRole("button", { name: "Add to the codex" }).click();
  const card = page.locator(".entry-card", { hasText: "Mara Vale" });
  await card.waitFor();
  const text = await card.innerText();
  ok(text.includes("shared") && text.includes("Ears: tall russet fox ears"), "the card is marked shared and shows the base's facts: " + text.replace(/\n/g, " | "));
  ok(!(await send("GET", `/api/chapters/${R}/codex`)).entries.some((e) => e.name === "Mara Vale"), "it isn't in the codex above Chapter A");

  // ---- its page in the story: details come from the base; facts can be changed here ----
  await card.click();
  await page.getByRole("heading", { name: "Mara Vale", level: 1 }).waitFor();
  const body = await page.locator(".entry-editor").innerText();
  ok(body.includes("This entry is shared") && body.includes("Base notes."), "the entry page says it is shared and shows the base's notes");
  ok((await page.getByRole("link", { name: "shared entry", exact: true }).getAttribute("href")) === `/shared/${sid}`, "…and links to the base");
  ok((await page.getByRole("button", { name: "Save changes" }).count()) === 0, "…with no form for the details");

  // ---- the base page lists the story ----
  await page.goto(sharedUrl);
  await page.getByRole("heading", { name: "Used in" }).waitFor();
  ok(await page.getByRole("link", { name: "Shared Tale" }).isVisible(), "the base page lists the story that uses it");
  ok(await page.getByRole("button", { name: /^Delete/ }).isDisabled(), "…and an entry in use can't be deleted");

  // ---- an unused entry can be deleted ----
  const spare = (await post("/api/shared", { name: "Spare Thing", type: "item" })).id;
  made.push(spare);
  await page.goto(`${BASE}/shared`);
  await page.locator(".entry-card", { hasText: "Spare Thing" }).click();
  await page.getByRole("button", { name: /^Delete/ }).click();
  await page.getByRole("heading", { name: "Shared codex", level: 1 }).waitFor();
  ok((await page.locator(".entry-card", { hasText: "Spare Thing" }).count()) === 0, "an unused entry is deleted from the list");

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(sharedUrl);
  await page.getByRole("heading", { name: "Mara Vale", level: 1 }).waitFor();
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the base page fits a phone screen");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
