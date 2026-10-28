import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
// The AI the server calls for the Check continuity button: each chapter states its eye colour, and the judge says contradiction.
const aiCalls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const user = body.messages.at(-1).content;
    aiCalls.push({ model: body.model, user });
    const early = user.includes('Chapter to read: "Dawn"');
    const out = user.includes("Summary to check:")
      ? user.includes('Chapter: "Night"') ? { ok: false, problem: "Adds a dragon." } : { ok: true }
      : user.includes("Is this a contradiction")
      ? { verdict: "contradiction" }
      : { facts: [{ entity: "Mira", attribute: "eye colour", value: early ? "green" : "blue", quote: early ? "Mira has green eyes." : "Mira has blue eyes." }] };
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(out) } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const post = (url, body) => send("POST", url, body);

// A story with one good chapter (the root), one with no summary, and one edited after its summary was made.
const s = await post("/api/stories", { title: "Review story", chapter: { title: "Good root", body: "root", summary: "root sum", choices: ["a", "b"] } });
const choices = (await send("GET", `/api/chapters/${s.chapter_id}`)).choices;
const noSummary = (await post("/api/chapters", { choice_id: choices[0].id, title: "Missing one", body: "no summary here" })).chapter_id;
const stale = (await post("/api/chapters", { choice_id: choices[1].id, title: "Stale one", body: "first text", summary: "stale sum" })).chapter_id;
const patched = await send("PATCH", `/api/chapters/${stale}`, { base_revision: 1, title: "Stale one", body: "second text", summary: "stale sum" });
if (!patched.chapter && patched.error) { console.log("FAIL could not edit the chapter", patched.error); process.exit(1); }

const settingsBefore = (await send("GET", "/api/settings")).settings;
const putSettings = (s) => send("PUT", "/api/settings", s);

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

try {
  // Home page menu.
  await page.goto(BASE);
  await page.locator(".story-card", { hasText: "Review story" }).locator("summary").click();
  const menuLink = page.locator(".story-card", { hasText: "Review story" }).getByRole("link", { name: "Story Bible", exact: true });
  ok((await menuLink.getAttribute("href")) === `/s/${s.story_id}/review`, "the story menu has a Story Bible link");
  await menuLink.click();
  await page.waitForURL(`**/s/${s.story_id}/review`);

  // Overview is the default tab: a card for each of the other tabs.
  const tabLink = (name) => page.locator('nav[aria-label="Story Bible"] a', { hasText: name });
  ok(await page.getByRole("heading", { name: "Story Bible", level: 1 }).isVisible(), "the Story Bible page opens");
  ok((await tabLink("Overview").getAttribute("aria-current")) === "page", "Overview is the default tab");
  for (const t of ["Issues", "Continuity", "Codex", "Tags", "Summaries"]) {
    ok(await page.locator("a.bible-card", { has: page.getByRole("heading", { name: t, level: 2 }) }).isVisible(), `the Overview has a ${t} card`);
  }
  ok(await page.getByRole("button", { name: "Check the whole story" }).isVisible(), "the Overview has a Checks card with Check the whole story");
  ok((await tabLink("Issues").innerText()).includes("2"), "the Issues tab link shows the open count");
  ok((await tabLink("Issues").locator(".count-chip").getAttribute("aria-label")) === ", 2 open", "…as ', 2 open' for screen readers");
  await page.locator("a.bible-card", { has: page.getByRole("heading", { name: "Issues", level: 2 }) }).click();
  await page.waitForURL(/tab=issues/);
  ok((await tabLink("Issues").getAttribute("aria-current")) === "page", "clicking an Overview card opens that tab");

  // The Show picker narrows to a chapter and keeps the tab.
  await page.locator("#bible-chapter").selectOption(noSummary);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.waitForURL(new RegExp(`tab=issues&chapter=${noSummary}`));
  ok((await tabLink("Issues").getAttribute("aria-current")) === "page" && (await page.getByRole("link", { name: "Fix the summary" }).count()) === 1, "the Show picker narrows to a chapter and keeps the tab");
  await page.getByRole("link", { name: "Show the whole story" }).click();
  await page.waitForURL(new RegExp(`tab=issues$`));

  // The old summaries page now opens the Summaries tab.
  await page.goto(`${BASE}/s/${s.story_id}/summaries`);
  await page.waitForURL(/review\?tab=summaries/);
  ok((await tabLink("Summaries").getAttribute("aria-current")) === "page", "/summaries redirects to the Summaries tab");

  // Issues tab, unfiltered.
  await page.goto(`${BASE}/s/${s.story_id}/review?tab=issues`);
  ok((await page.getByRole("link", { name: "Fix the summary" }).count()) === 2, "two issues are listed");
  const hrefs = await page.getByRole("link", { name: "Fix the summary" }).evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  ok(hrefs.includes(`/c/${noSummary}/summary`) && hrefs.includes(`/c/${stale}/summary`), "each has a Fix the summary link to its summary page");
  ok((await page.getByRole("link", { name: "Missing one" }).count()) === 1 && (await page.getByRole("link", { name: "Stale one" }).count()) === 1, "both problem chapters are named");
  ok((await page.getByRole("link", { name: "Good root" }).count()) === 0, "the good chapter is not listed");
  const redo = page.getByRole("link", { name: "Redo all the AI summaries" });
  ok((await redo.getAttribute("href")) === `/s/${s.story_id}/review?tab=summaries`, "Redo all the AI summaries links to the Summaries tab");
  await page.goto(`${BASE}/s/${s.story_id}/review?tab=codex`);
  ok((await page.getByText("AI codex helper").count()) === 0 && await page.getByText("Pick a chapter under Show, above, to check its codex.").isVisible(), "no codex helper until a chapter is chosen");

  // Choosing a chapter with the Show picker.
  await page.locator("#bible-chapter").selectOption(stale);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.waitForURL(new RegExp(`tab=codex&chapter=${stale}`));
  ok(await page.getByText(/Showing .*Stale one.* only/).isVisible(), "choosing a chapter filters the page to it");
  ok(await page.getByText("AI codex helper").first().isVisible(), "the AI codex helper is shown for the chosen chapter");
  await page.goto(`${BASE}/s/${s.story_id}/review?tab=issues&chapter=${stale}`);
  ok((await page.getByRole("link", { name: "Fix the summary" }).count()) === 1 && (await page.getByRole("link", { name: "Redo all the AI summaries" }).count()) === 0, "only that chapter's issue is listed");

  // Outline markers.
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  const row = (t) => page.locator("li", { has: page.getByRole("link", { name: t, exact: true }) }).last();
  const marker = (t) => row(t).locator("a.outline-review");
  ok((await marker("Missing one").innerText()).trim() === "⚠ 1" && (await marker("Stale one").innerText()).trim() === "⚠ 1", "both problem chapters show ⚠ 1");
  ok((await page.locator("a.outline-review").count()) === 2, "only the two problem chapters have a marker (none on the good one)");
  ok((await page.locator("summary", { hasText: "Good root" }).first().locator("a.outline-review").count()) === 0, "the good root has no marker on its own line");
  await page.locator(".site-menu > summary").click();
  ok((await page.getByRole("link", { name: "Story Bible", exact: true }).getAttribute("href")) === `/s/${s.story_id}/review`, "the outline menu has Story Bible");
  ok((await page.getByRole("link", { name: "Story Bible", exact: true }).count()) === 1, "…exactly once");
  ok((await page.getByRole("link", { name: "Redo the AI summaries" }).getAttribute("href")) === `/s/${s.story_id}/review?tab=summaries`, "…and Redo the AI summaries opens the Summaries tab");
  await marker("Missing one").click();
  await page.waitForURL(new RegExp(`/review\\?chapter=${noSummary}$`));
  ok(await page.getByText(/Showing .*Missing one.* only/).isVisible(), "the marker opens the Story Bible filtered to that chapter");
  await page.goto(`${BASE}/s/${s.story_id}/review?tab=issues&chapter=${noSummary}`);

  // Later / Dismiss / Undo on the filtered page for "Missing one".
  const fix = page.getByRole("link", { name: "Fix the summary" });
  const btn = (n) => page.getByRole("button", { name: n, exact: true });
  await btn("Later").click();
  await page.getByRole("heading", { name: "Later", level: 3 }).waitFor();
  ok((await page.getByRole("heading", { name: "Later", level: 3 }).isVisible()) && (await page.locator("li", { hasText: "Missing one" }).count()) === 1, "Later moves the issue under a Later heading");
  ok((await page.getByText("Nothing left to deal with here.").isVisible()), "…and the open list says nothing is left, not that the summary is fine");
  await btn("Back to the list").click();
  await page.getByRole("heading", { name: "Later", level: 3 }).waitFor({ state: "detached" });
  ok((await fix.count()) === 1 && (await btn("Dismiss").count()) === 1, "Back to the list returns it to the open issues");
  await btn("Dismiss").click();
  await page.getByText("Dismissed (1)").waitFor();
  ok((await fix.count()) === 0 && (await page.getByText("Dismissed (1)").isVisible()), "Dismiss removes it from the list and counts it under Dismissed (1)");
  await page.getByText("Dismissed (1)").click();
  ok(await page.getByText("A dismissed issue comes back if the chapter is edited.").isVisible(), "the Dismissed section explains that an edit brings it back");
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  ok((await marker("Missing one").count()) === 0 && (await marker("Stale one").count()) === 1, "a dismissed issue no longer shows the outline marker");
  await page.goto(`${BASE}/s/${s.story_id}/review?tab=issues&chapter=${noSummary}`);
  await page.getByText("Dismissed (1)").click();
  await btn("Undo").click();
  await fix.waitFor();
  ok((await fix.count()) === 1 && (await page.getByText("Dismissed (1)").count()) === 0, "Undo brings the issue back");

  // Turn the marker off in settings.
  await putSettings({ ...(settingsBefore ?? {}), outline: { summary: true, readToHere: true, headerPicture: true, footerPicture: true, illustrate: true, ...(settingsBefore?.outline ?? {}), review: false } });
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  ok((await page.getByRole("link", { name: "Good root" }).count()) === 1 && (await page.locator("a.outline-review").count()) === 0, "with Review marker off, no marker is shown");

  // Continuity: a stored contradiction shows with both chapters and both quotes; Dismiss hides it.
  // (The outline marker is switched back on for this part.)
  await putSettings(settingsBefore ?? {});
  const c = await post("/api/stories", { title: "Continuity story", chapter: { title: "Dawn", body: "Mira has green eyes. It was morning.", summary: "d", choices: ["on"] } });
  const cChoice = (await send("GET", `/api/chapters/${c.chapter_id}`)).choices[0];
  const dusk = (await post("/api/chapters", { choice_id: cChoice.id, title: "Dusk", body: "Mira has blue eyes. It was evening.", summary: "e" })).chapter_id;
  await post(`/api/stories/${c.story_id}/continuity`, {
    verdict: "contradiction",
    entity: "Mira",
    attribute: "eye colour",
    before: { chapterId: c.chapter_id, revision: 1, value: "green", quote: "Mira has green eyes." },
    after: { chapterId: dusk, revision: 1, value: "blue", quote: "Mira has blue eyes." },
  });
  await page.goto(`${BASE}/s/${c.story_id}/review?tab=continuity`);
  ok(await page.getByRole("heading", { name: "Clashes", level: 2 }).isVisible(), "the Continuity tab lists the clashes");
  const clash = page.locator("li", { hasText: "eye colour" });
  ok((await clash.count()) === 1 && (await clash.innerText()).includes("“green” in Dawn, then “blue” in Dusk"), "the issue says what changed and where");
  ok((await clash.getByRole("link", { name: "Dawn" }).getAttribute("href")) === `/c/${c.chapter_id}` && (await clash.getByRole("link", { name: "Dusk" }).getAttribute("href")) === `/c/${dusk}`, "…linking to both chapters");
  ok((await clash.innerText()).includes("Mira has green eyes.") && (await clash.innerText()).includes("Mira has blue eyes."), "…with both quotes");
  await page.goto(`${BASE}/s/${c.story_id}/outline`);
  ok((await page.locator("a.outline-review").count()) === 1, "the outline marks the later chapter");
  await page.goto(`${BASE}/s/${c.story_id}/review?tab=continuity&chapter=${c.chapter_id}`);
  ok((await page.locator("li", { hasText: "eye colour" }).count()) === 1, "choosing the earlier chapter shows the issue too");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByText("Dismissed (1)").waitFor();
  ok((await page.getByRole("button", { name: "Dismiss", exact: true }).count()) === 0 && (await page.getByText("Nothing left to deal with here.").count()) >= 1, "Dismiss moves it under Dismissed");
  await page.goto(`${BASE}/s/${c.story_id}/outline`);
  ok((await page.locator("a.outline-review").count()) === 0, "…and the outline marker goes");

  // Intentional: asks why, keeps the note, and files the issue under Dismissed with it.
  await page.goto(`${BASE}/s/${c.story_id}/review?tab=continuity`);
  await page.getByText("Dismissed (1)").click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Intentional", exact: true }).waitFor();
  ok((await page.getByRole("button", { name: "Dismiss", exact: true }).count()) === 1, "Undo brings the continuity issue back");
  await page.getByRole("button", { name: "Intentional", exact: true }).click();
  const why = page.getByPlaceholder("Why it's on purpose, e.g. a disguise");
  const save = page.getByRole("button", { name: "Save", exact: true });
  ok((await why.isVisible()) && (await save.isDisabled()), "Intentional asks for a note, and Save waits for one");
  ok(await page.getByText("No codex entry named Mira; the note is kept here only.").isVisible(), "…saying when no codex entry matches");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  ok((await why.count()) === 0, "Cancel closes the note box");
  await page.getByRole("button", { name: "Intentional", exact: true }).click();
  await why.fill("a disguise");
  ok(await save.isEnabled(), "Save is enabled once there is a note");
  await save.click();
  await page.getByText("Dismissed (1)").waitFor();
  ok((await page.getByRole("button", { name: "Intentional", exact: true }).count()) === 0, "Save takes it off the open list");
  await page.getByText("Dismissed (1)").click();
  ok(await page.getByText("Intentional: a disguise").isVisible(), "the Dismissed section shows the note");
  await page.goto(`${BASE}/s/${c.story_id}/outline`);
  ok((await page.locator("a.outline-review").count()) === 0, "an intentional issue has no outline marker");

  // AI-written chapters: listed under Written by AI, and Mark reviewed takes the chapter off the list.
  await send("PUT", "/api/queue/paused", { paused: true });
  const w = await post("/api/stories", { title: "AI review story", chapter: { title: "AI root", body: "root", summary: "r", choices: ["on"] } });
  const wRun = (await send("POST", "/api/ai-runs", { story_id: w.story_id, start_chapter_id: null, mode: "review", options: { checks: ["summaries"] } })).id;
  const wChoice = (await send("GET", `/api/chapters/${w.chapter_id}`)).choices[0];
  const written = (await post("/api/chapters", { choice_id: wChoice.id, title: "AI written", body: "ai text", summary: "a", ai_run_id: wRun })).chapter_id;
  await send("PUT", "/api/queue/paused", { paused: false });
  await send("DELETE", `/api/ai-runs/${wRun}/queue?end=1`);
  await page.goto(`${BASE}/s/${w.story_id}/review?tab=issues`);
  ok(await page.getByRole("heading", { name: "Written by AI", level: 2 }).isVisible(), "the Issues tab has a Written by AI section");
  const aiRow = page.locator("li", { hasText: "Written by AI and not read yet." });
  ok((await aiRow.count()) === 1 && (await aiRow.getByRole("link", { name: "AI written" }).getAttribute("href")) === `/c/${written}`, "the AI-written chapter is listed, linking to it");
  await aiRow.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await page.getByText("Every chapter the AI wrote has been read.").waitFor();
  ok((await page.locator("li", { hasText: "Written by AI and not read yet." }).count()) === 0, "Mark reviewed takes it off the list");

  // Codex gaps: a name in two chapters on a path with no codex entry shows in the Codex section.
  const g = await post("/api/stories", { title: "Gap story", chapter: { title: "Gap one", body: "Ilsa waits.", summary: "g", choices: ["on"] } });
  const gChoice = (await send("GET", `/api/chapters/${g.chapter_id}`)).choices[0];
  const gTwo = (await post("/api/chapters", { choice_id: gChoice.id, title: "Gap two", body: "Ilsa leaves.", summary: "g2" })).chapter_id;
  for (const id of [g.chapter_id, gTwo]) await post(`/api/chapters/${id}/facts`, { revision: 1, facts: [{ entity: "Ilsa", attribute: "mood", value: "calm", quote: "Ilsa" }] });
  await page.goto(`${BASE}/s/${g.story_id}/review?tab=codex`);
  const gap = page.locator("li", { hasText: "has no codex entry" });
  ok((await gap.count()) === 1 && (await gap.innerText()).includes("Ilsa") && (await gap.innerText()).includes("Gap one"), "the Codex tab lists the name that has no entry");
  ok((await gap.getByRole("link", { name: "Check the codex here" }).getAttribute("href")) === `/s/${g.story_id}/review?tab=codex&chapter=${g.chapter_id}`, "…with a link that opens the codex check at the first chapter");
  await gap.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByText("Dismissed (1)").waitFor();
  ok((await page.getByRole("link", { name: "Check the codex here" }).count()) === 0, "Dismiss takes it off the open list");

  // The Codex tab lists every entry, with type filter links.
  await post("/api/codex", { anchor_chapter_id: g.chapter_id, op: "create", name: "Ilsa Vane", type: "character", aliases: [], content: "x", always_include: false });
  await post("/api/codex", { anchor_chapter_id: g.chapter_id, op: "create", name: "Old Mill", type: "place", aliases: [], content: "x", always_include: false });
  await page.goto(`${BASE}/s/${g.story_id}/review?tab=codex`);
  await page.getByRole("heading", { name: "Entries (2)" }).waitFor();
  ok((await page.getByRole("link", { name: "Ilsa Vane" }).count()) === 1 && (await page.getByRole("link", { name: "Old Mill" }).count()) === 1, "the Codex tab lists every codex entry");
  const filter = page.locator('nav[aria-label="Filter entries by type"]');
  await filter.getByRole("link", { name: /^Places/ }).click();
  await page.waitForURL(/type=place/);
  ok((await page.getByRole("heading", { name: "Entries (1)" }).isVisible()) && (await page.getByRole("link", { name: "Ilsa Vane" }).count()) === 0 && (await page.getByRole("link", { name: "Old Mill" }).count()) === 1, "a type filter link narrows the list");
  ok((await tabLink("Codex").getAttribute("aria-current")) === "page", "…and stays on the Codex tab");

  // The Check continuity button: reads the facts of both chapters, then asks the judge once.
  const ai = await useMockAi(BASE);
  const d = await post("/api/stories", { title: "Continuity run story", chapter: { title: "Dawn", body: "Mira has green eyes. It was morning.", summary: "d", choices: ["on"] } });
  const dChoice = (await send("GET", `/api/chapters/${d.chapter_id}`)).choices[0];
  const dDusk = (await post("/api/chapters", { choice_id: dChoice.id, title: "Dusk", body: "Mira has blue eyes. It was evening.", summary: "e" })).chapter_id;
  await page.goto(`${BASE}/s/${d.story_id}/review?tab=continuity`);
  ok(await page.getByText("No continuity problems found yet.").isVisible(), "a story with no verdicts says none were found yet");
  ok(await page.getByText("Reads each chapter for facts, then asks about each clash. Uses your cheaper model.").isVisible(), "the Check continuity section explains what it does");
  ok((await page.locator('input[name="continuity-scope"]').count()) === 1, "without a chosen chapter only The whole story is offered");
  await page.getByRole("button", { name: "Check continuity" }).click();
  await page.getByText("Found 1 contradiction.").waitFor({ timeout: 30000 });
  ok(aiCalls.filter((x) => x.user.includes("Chapter to read")).length === 2 && aiCalls.filter((x) => x.user.includes("Is this a contradiction")).length === 1, "two fact reads and one judge call were made");
  ok(aiCalls.every((x) => x.model === "cheap"), "…all on the cheaper model");
  const found = page.locator("li", { hasText: "eye colour" });
  await found.waitFor();
  ok((await found.getByRole("link", { name: "Dusk" }).getAttribute("href")) === `/c/${dDusk}`, "the contradiction appears in the section when the run ends");
  await page.goto(`${BASE}/s/${d.story_id}/review?tab=continuity&chapter=${dDusk}`);
  ok((await page.locator('input[name="continuity-scope"]').count()) === 3, "a chosen chapter offers this chapter, the way here and the whole story");

  // Summaries that don't match: an issue seeded through the route shows under Summaries, and Check summaries checks the rest.
  const e = await post("/api/stories", { title: "Summary check story", chapter: { title: "Morning", body: "A storm broke at dawn.", summary: "A quiet dawn.", choices: ["on"] } });
  const eChoice = (await send("GET", `/api/chapters/${e.chapter_id}`)).choices[0];
  const eNight = (await post("/api/chapters", { choice_id: eChoice.id, title: "Night", body: "The stars came out.", summary: "Stars and a dragon." })).chapter_id;
  const seeded = await fetch(`${BASE}/api/chapters/${e.chapter_id}/summary-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 1, summary: "A quiet dawn.", verdict: "wrong", problem: "Leaves out the storm." }),
  });
  ok(seeded.status === 200, "a summary check can be saved through the route");
  await page.goto(`${BASE}/s/${e.story_id}/review?tab=issues`);
  const wrongItem = page.locator("li", { hasText: "The summary doesn't match the chapter: Leaves out the storm." });
  ok(await wrongItem.isVisible(), "a summary that doesn't match shows under Summaries");
  ok((await wrongItem.getByRole("link", { name: "Fix the summary" }).getAttribute("href")) === `/c/${e.chapter_id}/summary`, "…with a Fix the summary link to its summary page");
  ok(await page.getByText("Reads each chapter and its summary, and says when they don't match. Uses your cheaper model.").isVisible(), "the Check summaries section explains what it does");
  ok((await page.locator('input[name="summary-scope"]').count()) === 1, "without a chosen chapter only The whole story is offered");
  const summaryCallsBefore = aiCalls.filter((x) => x.user.includes("Summary to check:")).length;
  await page.getByRole("button", { name: "Check summaries" }).click();
  await page.getByText("Found 1 summary that doesn't match.").waitFor({ timeout: 30000 });
  const summaryCalls = aiCalls.slice().filter((x) => x.user.includes("Summary to check:"));
  ok(summaryCalls.length - summaryCallsBefore === 1 && summaryCalls.at(-1).user.includes('Chapter: "Night"') && summaryCalls.at(-1).model === "cheap", "only the chapter not yet checked was sent to the cheaper model");
  await page.locator("li", { hasText: "The summary doesn't match the chapter: Adds a dragon." }).waitFor();
  ok((await page.locator("li", { hasText: "The summary doesn't match the chapter: Adds a dragon." }).getByRole("link", { name: "Fix the summary" }).getAttribute("href")) === `/c/${eNight}/summary`, "the new issue appears when the run ends");
  await ai.restore();
} finally {
  mock.close();
  await putSettings(settingsBefore ?? {});
  await browser.close();
}
// Settings are restored; the story is left in place like the other tests' stories.
process.exit(failed ? 1 : 0);
