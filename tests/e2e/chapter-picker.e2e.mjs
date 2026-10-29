import { launch, useMockAi } from "./browser.mjs";

// The chapter pickers. Section A: "Takes effect from" (ChapterPathPicker), which offers only the chapters on the
// current branch: quick choices, "Earlier…" with the path, the tint and the line that says what the pick means.
// Later sections are added below as their own functions and called at the end.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // nothing here calls the AI
const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- a story with six chapters in a row (so every button shows), and an entry made in the first ----
const TITLES = ["Hollow Start", "Marsh Road", "The Ferry Landing", "The Lantern Tower", "The Bite", "Second Moon"];
const story = await post("/api/stories", { title: "Picker Tale", premise: "p", chapter: { title: TITLES[0], body: "Rowan stood there.", choices: ["Onward"] } });
const sid = story.story_id;
const chapters = [story.chapter_id];
for (let i = 1; i < TITLES.length; i++) {
  const choice = (await send("GET", `/api/chapters/${chapters[i - 1]}`)).choices[0];
  const made = await post("/api/chapters", { choice_id: choice.id, title: TITLES[i], body: `Chapter ${i}.`, choices: i < TITLES.length - 1 ? ["Onward"] : [] });
  chapters.push(made.chapter_id);
}
const last = chapters.length - 1;
const rowan = (await post("/api/codex", { anchor_chapter_id: chapters[0], op: "create", name: "Rowan", type: "character", aliases: ["Ro"], content: "", always_include: false })).entry_id;
const entryUrl = (at) => `${BASE}/s/${sid}/codex/${rowan}?at=${at}`;
const aliasesAt = async (chapter) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === "Rowan")?.aliases.join() ?? "";

const box = async (loc) => await loc.first().boundingBox();
const pressed = async (loc) => (await loc.getAttribute("aria-pressed")) === "true";

try {
  await sectionA();
} finally {
  await send("DELETE", `/api/stories/${sid}`);
  await ai.restore();
  await browser.close();
}
process.exit(failed ? 1 : 0);

async function sectionA() {
  console.log("-- A: Takes effect from");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(entryUrl(chapters[last]));
  const details = page.locator(".entry-editor form.entry-details-form");
  await details.waitFor();
  const group = details.getByRole("group", { name: "Takes effect from" });
  const pill = (name) => group.getByRole("button", { name, exact: true });
  const previous = group.getByRole("button", { name: /^Previous chapter/ });
  const explain = details.locator(".chapter-picker-explain");
  const pathButtons = details.locator(".chapter-picker-chapter");
  const text = async () => (await explain.innerText()).replace(/\s+/g, " ").trim();

  // the buttons and their wording
  const names = (await group.getByRole("button").allInnerTexts()).map((t) => t.trim());
  ok(names.join("|") === `This chapter|Previous chapter (${TITLES[last - 1]})|The start|Earlier…`, "four buttons with the exact wording: " + names.join("|"));
  ok((await pathButtons.count()) === 0, "the path is hidden until Earlier… is pressed");
  ok((await pressed(pill("This chapter"))) && (await text()) === `Applies from “${TITLES[last]}” on: this chapter and every chapter after it on this branch`, "it starts on this chapter, and says what that means: " + (await text()));

  // each quick choice saves the right anchor (this chapter and the ones after it have the keyword, the ones before do not)
  // (Saving rebuilds the form on this chapter, so the line and the pressed button are read before saving.)
  let n = 0;
  let lineBefore = "";
  let pressedBefore = "";
  const saveWith = async (choose) => {
    const word = `kw${++n}`;
    await choose();
    lineBefore = await text();
    pressedBefore = (await group.locator("[aria-pressed=true]").allInnerTexts()).join("|");
    await details.getByLabel(/Keywords/).fill(`Ro, ${word}`);
    await details.getByRole("button", { name: "Save changes" }).click();
    await details.getByText("Saved", { exact: true }).waitFor();
    return word;
  };
  const has = async (chapter, word) => (await aliasesAt(chapter)).split(",").includes(word);
  let word = await saveWith(async () => pill("This chapter").click());
  ok((await has(chapters[last], word)) && !(await has(chapters[last - 1], word)), "This chapter saves at the current chapter");
  word = await saveWith(async () => previous.click());
  ok(pressedBefore.startsWith("Previous chapter") && (await has(chapters[last - 1], word)) && !(await has(chapters[last - 2], word)), "Previous chapter saves at the chapter before");
  ok(lineBefore === `Applies from “${TITLES[last - 1]}” on: 2 chapters up to here and every chapter after it on this branch`, "…and the line counts the chapters: " + lineBefore);
  word = await saveWith(async () => pill("The start").click());
  ok(pressedBefore === "The start" && (await has(chapters[0], word)) && (await has(chapters[last], word)), "The start saves at the first chapter");
  ok(lineBefore === "Applies to the whole story on this branch", "…and the line says the whole story: " + lineBefore);

  // Earlier… shows the path in order; a chapter picked there is saved
  await pill("Earlier…").click();
  ok(await pressed(pill("Earlier…")), "Earlier… is pressed once it is open");
  const shown = (await pathButtons.allInnerTexts()).map((t) => t.trim());
  ok(shown.join("|") === TITLES.map((t, i) => (i === last ? `${t} (this chapter)` : t)).join("|"), "the path lists the chapters in order, the last one marked: " + shown.join("|"));
  const xs = await Promise.all([0, 1, 2].map(async (i) => (await box(pathButtons.nth(i))).y));
  ok(Math.abs(xs[0] - xs[1]) < 6 && Math.abs(xs[1] - xs[2]) < 6, "on a wide screen the chapters are in a row");
  // Earlier… from a quick choice moves the pick to a chapter before the quick ones
  ok((await pathButtons.nth(last - 2).getAttribute("data-tint")) === "chosen", "pressing Earlier… from a quick choice picks the chapter two back");
  await pathButtons.nth(2).click();
  const tints = await pathButtons.evaluateAll((els) => els.map((e) => e.getAttribute("data-tint") ?? ""));
  ok(tints.join("|") === ["", "", "chosen", "after", "after", "after"].join("|"), "the chosen chapter is tinted strongly and the ones after it softly: " + tints.join("|"));
  const chosenBg = await pathButtons.nth(2).evaluate((e) => getComputedStyle(e).backgroundColor);
  const afterBg = await pathButtons.nth(3).evaluate((e) => getComputedStyle(e).backgroundColor);
  const plainBg = await pathButtons.nth(1).evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(chosenBg !== afterBg && afterBg !== plainBg && chosenBg !== plainBg, "…and the three look different");
  ok((await text()) === `Applies from “${TITLES[2]}” on: 4 chapters up to here and every chapter after it on this branch`, "the line follows the pick: " + (await text()));
  ok((await pathButtons.nth(2).getAttribute("aria-pressed")) === "true" && (await pathButtons.nth(3).getAttribute("aria-pressed")) === "false", "the chosen chapter is the pressed one");
  word = await saveWith(async () => {});
  ok((await has(chapters[2], word)) && (await has(chapters[last], word)) && !(await has(chapters[1], word)), "a chapter picked under Earlier… saves at that chapter");

  // a pick that is not a quick choice keeps the path open after a reload
  await page.reload();
  await details.waitFor();
  ok((await pathButtons.count()) === 0 && (await pressed(pill("This chapter"))), "after a reload the form starts on this chapter again, path closed");
  await pill("Earlier…").click();
  await pathButtons.nth(1).click();
  await pill("The start").click();
  ok((await pathButtons.count()) === 0 && (await pressed(pill("The start"))) && !(await pressed(pill("Earlier…"))), "a quick choice closes the path");

  // the same picker on the fact form and the form change
  const factsSection = page.locator(".entry-editor section", { has: page.getByRole("heading", { name: "Facts", exact: true }) });
  await factsSection.getByRole("button", { name: "+ Add a fact" }).click();
  const factForm = factsSection.locator(".fact-form");
  await factForm.getByLabel("Aspect").fill("Eyes");
  await factForm.getByLabel("Fact", { exact: true }).fill("amber");
  await factForm.getByRole("group", { name: "Takes effect from" }).getByRole("button", { name: "Earlier…" }).click();
  await factForm.locator(".chapter-picker-chapter").nth(3).click();
  await factForm.getByRole("button", { name: "Save", exact: true }).click();
  await factsSection.locator(".fact-line", { hasText: "amber" }).waitFor();
  const eyesAt = async (chapter) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === "Rowan")?.facts.some((f) => f.text === "amber");
  ok((await eyesAt(chapters[3])) && !(await eyesAt(chapters[2])), "a fact saved from Earlier… lands on the chapter picked");

  // the first chapter has no earlier chapters to offer
  await page.goto(entryUrl(chapters[0]));
  await details.waitFor();
  ok((await details.locator(".chapter-picker").count()) === 0, "the first chapter has no “Takes effect from” on the Details form, as before");

  // a short path: only the buttons that mean something
  await page.goto(entryUrl(chapters[1]));
  await details.waitFor();
  const shortNames = (await group.getByRole("button").allInnerTexts()).map((t) => t.trim());
  ok(shortNames.join("|") === `This chapter|Previous chapter (${TITLES[0]})`, "with two chapters: This chapter and Previous chapter only: " + shortNames.join("|"));
  await page.goto(entryUrl(chapters[2]));
  await details.waitFor();
  const three = (await group.getByRole("button").allInnerTexts()).map((t) => t.trim());
  ok(three.join("|") === `This chapter|Previous chapter (${TITLES[1]})|The start`, "with three chapters there is no Earlier…: " + three.join("|"));
  await page.goto(entryUrl(chapters[3]));
  await details.waitFor();
  ok((await group.getByRole("button", { name: "Earlier…" }).count()) === 1, "with four chapters Earlier… is there");

  // keyboard: the buttons can be reached and pressed
  await page.goto(entryUrl(chapters[last]));
  await details.waitFor();
  await pill("The start").focus();
  await page.keyboard.press("Enter");
  ok(await pressed(pill("The start")), "a button can be pressed from the keyboard");

  // phone: label above, the path as a vertical list
  await page.setViewportSize({ width: 390, height: 844 });
  await pill("Earlier…").click();
  await pathButtons.first().waitFor();
  const phone = await Promise.all([0, 1, 2, 3].map(async (i) => await box(pathButtons.nth(i))));
  ok(phone.every((b, i) => i === 0 || (b.y > phone[i - 1].y + phone[i - 1].height - 2 && Math.abs(b.x - phone[0].x) < 2)), "on a phone the path is a vertical list (stacked, same left edge)");
  const pageWidth = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(pageWidth[0] <= pageWidth[1], "…and the page doesn't scroll sideways");
  const label = await box(details.locator(".chapter-picker-label"));
  ok((await box(group)).y > label.y + label.height - 2, "…with the label above the buttons");
  await page.setViewportSize({ width: 1280, height: 800 });
}
