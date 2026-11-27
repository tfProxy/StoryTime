import { launch, useMockAi } from "./browser.mjs";

// Clearing a pile of open codex suggestions. On the writing desk an entry's Suggestions tab offers "Dismiss all N" beside
// "Waiting for you (N)" when two or more wait: it dismisses that entry's suggestions from the chapters on the desk's path
// (not another branch's), the list empties and the side row's badge goes. In the Story Bible's Codex, the ⋯ menu's
// "Dismiss every waiting suggestion…" asks, then dismisses all that wait in the story and says how many. Suggestions are
// seeded through the worker's route, so no AI is involved.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE, { autoApplyCodex: false }); // suggestions wait for the owner
const browser = await launch();
let sid = null;
try {
  // Root -> A and Root -> B (another branch). Rowan, Kestrel and Mira are in the codex from the root.
  const story = await post("/api/stories", { title: "Dismiss All Tale", premise: "p", chapter: { title: "Root", body: "Rowan, Kestrel and Mira stood there.", choices: ["Go", "Stay"] } });
  sid = story.story_id;
  const R = story.chapter_id;
  const choices = (await send("GET", `/api/chapters/${R}`)).choices;
  const A = (await post("/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Her ears changed. Her eyes glowed. Her hair was russet. Wings spread. A sharp beak. Mira smiled." })).chapter_id;
  const Bc = (await post("/api/chapters", { choice_id: choices[1].id, title: "Chapter B", body: "Her voice was a rasp." })).chapter_id;
  const make = async (name) => (await post("/api/codex", { anchor_chapter_id: R, op: "create", name, type: "character" })).entry_id;
  const rowan = await make("Rowan");
  const kestrel = await make("Kestrel");
  const mira = await make("Mira");
  const set = (entry_id, aspect, after, quote) => ({ kind: "set", entry_id, aspect, form: "", after, quote });
  const seed = (chapter, suggestions) => post(`/api/chapters/${chapter}/codex-suggestions`, { revision: 1, suggestions });
  const saved = [
    await seed(A, [
      set(rowan, "Ears", "tall fox ears", "Her ears changed"),
      set(rowan, "Eyes", "glowing eyes", "Her eyes glowed"),
      set(rowan, "Hair", "russet hair", "Her hair was russet"),
      set(kestrel, "Wings", "broad wings", "Wings spread"),
      set(kestrel, "Beak", "a sharp beak", "A sharp beak"),
      set(mira, "Mood", "smiling", "Mira smiled"),
    ]),
    await seed(Bc, [set(rowan, "Voice", "a low rasp", "Her voice was a rasp")]),
  ];
  ok(saved[0].saved === 6 && saved[1].saved === 1, "seven suggestions wait: " + JSON.stringify(saved));
  const open = async () => (await send("GET", `/api/stories/${sid}/codex-suggestions?status=open`)).suggestions.map((x) => `${x.entry_name}/${x.aspect}`).sort().join(", ");
  const dismissed = async () => (await send("GET", `/api/stories/${sid}/codex-suggestions?status=dismissed`)).suggestions.length;

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });

  // ---- the desk ----
  await page.goto(`${BASE}/c/${A}/desk`);
  const side = page.locator("aside.desk-side");
  const row = (name) => side.locator(".desk-group", { hasText: "Characters" }).locator(".desk-row", { has: page.locator(".desk-row-name", { hasText: new RegExp(`^${name}$`) }) });
  await row("Rowan").waitFor();
  const badge = (name) => row(name).locator(".desk-badge");
  ok((await badge("Rowan").innerText()).startsWith("3") && (await badge("Kestrel").innerText()).startsWith("2") && (await badge("Mira").innerText()).startsWith("1"), "the side rows' badges count what waits on this path: Rowan 3, Kestrel 2, Mira 1");

  // One waiting: no button to clear.
  await row("Mira").click();
  const entry = page.locator("section.desk-entry");
  await entry.getByRole("heading", { name: "Mira" }).waitFor();
  await entry.getByRole("heading", { name: "Waiting for you (1)" }).waitFor();
  ok((await entry.getByRole("button", { name: /^Dismiss all/ }).count()) === 0, "with one waiting there is no 'Dismiss all' (the row has its own Dismiss)");

  // Rowan: three waiting on the path.
  await row("Rowan").click();
  await entry.getByRole("heading", { name: "Rowan" }).waitFor();
  const heading = entry.getByRole("heading", { name: /^Waiting for you/ });
  await heading.waitFor();
  ok((await heading.textContent()) === "Waiting for you (3)", "Rowan has three waiting on the desk's path: " + (await heading.innerText()));
  ok((await entry.locator(".desk-sug").count()) === 3, "…listed");
  const all = entry.getByRole("button", { name: "Dismiss all 3" });
  ok((await all.count()) === 1, "'Dismiss all 3' is offered beside the heading");
  const before = await all.boundingBox();
  const head = await heading.boundingBox();
  ok(Math.abs(before.y - head.y) < 40, "…on the heading's line");

  const cleared = page.waitForResponse((r) => r.url().endsWith(`/api/stories/${sid}/codex-suggestions`) && r.request().method() === "POST");
  await all.click();
  const res = await cleared;
  ok(res.status() === 200 && (await res.json()).dismissed === 3 && res.request().postDataJSON().entry_id === rowan && res.request().postDataJSON().chapter_ids.includes(A), "it asks the server to dismiss Rowan's suggestions from the path's chapters, and three are");
  await entry.getByText("No suggestions waiting for Rowan.").waitFor();
  ok((await entry.locator(".desk-sug").count()) === 0 && (await entry.getByRole("button", { name: /^Dismiss all/ }).count()) === 0, "the list is empty and the button is gone");
  await page.waitForFunction(() => !document.querySelector(".desk-row.on .desk-badge"));
  ok((await badge("Rowan").count()) === 0, "Rowan's badge in the side column is gone");
  ok((await badge("Kestrel").innerText()).startsWith("2") && (await badge("Mira").innerText()).startsWith("1"), "…and the other entries' badges stay");
  ok((await open()) === "Kestrel/Beak, Kestrel/Wings, Mira/Mood, Rowan/Voice", "on the server only Rowan's three from this path are dismissed (his Voice, from the other branch, waits): " + (await open()));
  ok((await entry.getByRole("tab", { name: "Suggestions", exact: true }).count()) === 1, "the tab's count goes too");

  // Kestrel: two waiting, and clearing leaves Mira's.
  await row("Kestrel").click();
  await entry.getByRole("heading", { name: "Waiting for you (2)" }).waitFor();
  await entry.getByRole("button", { name: "Dismiss all 2" }).click();
  await entry.getByText("No suggestions waiting for Kestrel.").waitFor();
  ok((await open()) === "Mira/Mood, Rowan/Voice", "Kestrel's two are dismissed as well: " + (await open()));
  ok(dialogs.length === 0, "the desk's button asks no question (each can be reopened)");

  // ---- the Story Bible ----
  await send("POST", `/api/stories/${sid}/codex-suggestions`, {}); // (clear, then seed fresh ones so the menu has something to say)
  await seed(A, [
    set(kestrel, "Wings", "broad wings!", "Wings spread"),
    set(kestrel, "Beak", "a sharp beak!", "A sharp beak"),
  ]);
  ok((await open()) === "Kestrel/Beak, Kestrel/Wings", "two new suggestions wait: " + (await open()));
  await page.goto(`${BASE}/s/${sid}/review?tab=codex`);
  const menu = page.locator('summary[aria-label="Codex actions"]');
  await page.locator("a.entry-card", { hasText: "Kestrel" }).getByText("2 suggestions").waitFor();
  await menu.click();
  await page.getByRole("button", { name: /^Dismiss every waiting suggestion/ }).click();
  await page.getByText("Dismissed 2 suggestions.").waitFor();
  ok(dialogs.length === 1 && /Dismiss every codex suggestion still waiting in this story/.test(dialogs[0]), "the menu item asks first: " + dialogs[0]);
  ok((await open()) === "", "nothing waits any more");
  ok((await dismissed()) === 9, "…and every one is dismissed, none deleted (nine in all): " + (await dismissed()));
  await page.locator("a.entry-card", { hasText: "Kestrel" }).waitFor();
  ok((await page.locator("a.entry-card", { hasText: "Kestrel" }).getByText(/suggestion/).count()) === 0, "the entry cards no longer count suggestions");

  // With nothing waiting it says so.
  await menu.click();
  await page.getByRole("button", { name: /^Dismiss every waiting suggestion/ }).click();
  await page.getByText("No suggestions were waiting.").waitFor();
  ok(dialogs.length === 2, "…and with none waiting it still asks, then says 'No suggestions were waiting.'");

  // A cancelled question dismisses nothing.
  await seed(A, [set(mira, "Eyes", "green eyes", "Her eyes glowed")]);
  await page.reload();
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => void d.dismiss());
  await menu.click();
  await page.getByRole("button", { name: /^Dismiss every waiting suggestion/ }).click();
  await page.waitForTimeout(500);
  ok((await open()) === "Mira/Eyes", "cancelling the question dismisses nothing: " + (await open()));

  await context.close();
} finally {
  if (sid) await send("DELETE", `/api/stories/${sid}`);
  await browser.close();
  await ai.restore();
}
if (failed) process.exit(1);
