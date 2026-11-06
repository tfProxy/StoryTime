// New story › Import a story, in the browser: paste a story, split it on the queue (fake AI), review it (the chapter
// list, moving a break, merging, the choices), create it, then the Original marks and their switch on the reading page
// and the outline.
import { launch, useMockAi } from "./browser.mjs";
import { startFakeAi } from "../fakeAi.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };

const para = (n) => `Paragraph ${n} ${"dust ".repeat(38).trim()}`;
const text = `# The Salt Road\n\n${Array.from({ length: 12 }, (_, i) => para(i + 1)).join("\n\n")}`;

const ai = await startFakeAi({
  port: 3222,
  delay: 1,
  reply: (body) => {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
    if (system.includes("divide it into short chapters")) {
      return JSON.stringify([
        { end: 4, title: "Dust at the Back", choice: "Ask Dace about the wells" },
        { end: 8, title: "Lights on the Flats", choice: "Slip away to the lights" },
        { end: 12, title: "The Road Home", choice: "" },
      ]);
    }
    if (system.includes("other choices the main character could have made")) return '["Wake the guards", "Run back to Merrow"]';
    if (system.includes("set up a story")) return '{"premise": "A girl on a salt caravan.", "style": "Close third person."}';
    return "?";
  },
});
const mock = await useMockAi(BASE);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

try {
  await page.goto(`${BASE}/new?tab=import`);
  ok(await page.getByRole("link", { name: "Import a story" }).getAttribute("aria-current") === "page", "the Import tab is open");
  await page.getByLabel("The story").fill(text);
  ok(await page.getByText("480 words · 12 paragraphs").isVisible(), "the form counts the words and paragraphs");
  await page.getByLabel("Shortest chapter, in words").fill("100");
  await page.getByLabel("Longest chapter, in words").fill("200");
  await page.getByRole("button", { name: "Split into chapters" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/new/import/"));
  const importPath = new URL(page.url()).pathname;
  await page.getByRole("heading", { name: "Review the import" }).waitFor({ timeout: 15000 });
  ok(true, "the queue splits the story and the review opens");

  const toc = page.getByRole("navigation", { name: "Chapters" });
  ok((await toc.getByRole("link").allTextContents()).join("|").includes("Dust at the Back"), "the chapter list names the chapters");
  ok(await page.getByLabel("Title", { exact: true }).inputValue() === "The Salt Road", "the title comes from the text");
  ok(await page.getByLabel("Original choice after chapter 1").inputValue() === "Ask Dace about the wells", "the original choice");
  ok(await page.getByLabel("Suggested choice 1 after chapter 1").inputValue() === "Wake the guards", "…and the suggested ones");
  ok(await page.getByText("The end of the original story").isVisible() && await page.getByLabel("Suggested choice 2 after chapter 3").isVisible(), "the last chapter ends the original, with other endings");

  // Move the first break one paragraph later: chapter 1 gets five paragraphs (200 words), chapter 2 three.
  await page.getByRole("group", { name: "Break after chapter 1" }).getByRole("button", { name: "▼ A paragraph later" }).click();
  ok(await page.getByRole("region", { name: "Chapter 1" }).getByText("200 words").isVisible(), "moving a break changes the chapters' lengths");
  await page.getByRole("group", { name: "Break after chapter 2" }).getByRole("button", { name: "Merge" }).click();
  ok((await page.getByRole("region", { name: /^Chapter \d$/ }).count()) === 2, "merging two chapters leaves one");
  ok(await page.getByRole("region", { name: "Chapter 2" }).getByText("over 200").isVisible(), "…which is flagged as too long");
  await toc.getByLabel(/Only ones to check/).check();
  ok((await toc.getByRole("link").count()) === 1, "the chapter list can show only the ones to check");

  // Split the long chapter again by hand.
  const second = page.getByRole("region", { name: "Chapter 2" });
  await second.getByRole("button", { name: /Show the whole chapter/ }).click();
  await second.getByRole("button", { name: "Start a new chapter after this paragraph" }).nth(2).click();
  ok((await page.getByRole("region", { name: /^Chapter \d$/ }).count()) === 3, "a chapter can be split after a paragraph");
  ok(await page.getByText("Chapter 3 needs a title.").isVisible(), "…and the new chapter needs a title before the story can be made");
  ok(await page.getByRole("button", { name: "Create the story" }).isDisabled(), "…so Create waits");
  await page.getByLabel("Chapter 3 title").fill("Out on the Salt");
  ok(await page.getByText("Chapter 2 needs the choice that leads to chapter 3.").isVisible(), "…and the chapter before it the choice that leads there");
  await page.getByLabel("Original choice after chapter 2").fill("Walk out onto the salt");
  // Drop one suggestion on the first chapter.
  await page.getByRole("region", { name: "Chapter 1" }).getByRole("checkbox", { name: "Keep “Run back to Merrow”" }).uncheck();
  ok(await page.getByRole("button", { name: "Create the story" }).isEnabled(), "with those, the story can be made");

  // Leave and come back: the changes were saved into the draft.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole("heading", { name: "Review the import" }).waitFor();
  ok(await page.getByLabel("Chapter 3 title").inputValue() === "Out on the Salt", "the review's changes are kept");

  await page.getByRole("button", { name: "Create the story" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/c/"), { timeout: 10000 });
  ok(await page.getByRole("heading", { name: "Dust at the Back" }).isVisible(), "Create opens the story's first chapter");
  const original = page.locator(".choice-written", { hasText: "Ask Dace about the wells" });
  ok(await original.locator(".original-mark").isVisible(), "the original choice is marked");
  ok(await page.locator(".choice-unwritten", { hasText: "Wake the guards" }).isVisible(), "a suggested choice is there, not written yet");
  ok((await page.locator(".choices", { hasText: "Run back to Merrow" }).count()) === 0, "…and a dropped one is not");
  await page.getByLabel("Show the original path").uncheck();
  await page.waitForFunction(() => !document.querySelector(".original-mark"));
  ok(true, "the switch hides the mark");
  await page.reload();
  ok(!(await page.getByLabel("Show the original path").isChecked()) && (await page.locator(".original-mark").count()) === 0, "…and is remembered");

  await page.getByRole("link", { name: "Outline" }).first().click();
  await page.getByRole("heading", { name: "Outline" }).waitFor();
  ok((await page.locator(".original-mark").count()) === 0, "the outline has no marks while the switch is off");
  await page.getByLabel("Show the original path").check();
  await page.waitForFunction(() => document.querySelectorAll(".original-mark").length === 3);
  ok(true, "…and marks the original path when it is on");

  await page.goto(BASE + importPath);
  ok(!!(await page.getByText("This import is gone").waitFor().then(() => true, () => false)), "the import's page says it is gone once the story is made");
} finally {
  await browser.close();
  await mock.restore();
  await ai.close();
}
process.exit(failed ? 1 : 0);
