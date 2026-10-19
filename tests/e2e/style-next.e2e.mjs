// Story style notes reach the prompts and can be saved from any writing page; "Post and write
// next" posts a chapter and opens the chosen choice for writing.
import http from "node:http";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const prompts = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    prompts.push({ system, user });
    let text = "# Generated\n\nGenerated text here.";
    if (system.includes("running summary")) text = JSON.stringify({ summary: "S", story_so_far: "SF" });
    else if (system.includes("button text and nothing else")) text = "Carry on";
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
const lastChapterPrompt = () => [...prompts].reverse().find((p) => p.system.includes("Output format"))?.user ?? "";

const settingsBefore = (await json("GET", "/api/settings")).settings;
await json("PUT", "/api/settings", { ...(settingsBefore ?? {}), activeProvider: "ollama", autoSuggestChoices: false, providers: { ...(settingsBefore?.providers ?? {}), ollama: { baseUrl: "http://localhost:3222/v1", apiKey: "", model: "main", summaryModel: "cheap" } } });

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- a new story with style notes ----
await page.goto(`${BASE}/new`);
await page.getByLabel("Story title").fill("Styled tale");
await page.getByLabel(/^Style notes/).fill("STYLE-NEW: first person.");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok(lastChapterPrompt().includes("Style notes from the author (follow these in everything you write):\nSTYLE-NEW: first person."), "a new story's style notes go into the prompt");
ok(!(await page.getByRole("button", { name: "Post and write next" }).isVisible()), "no “Post and write next” without choices");

await page.getByPlaceholder("Choice 1").fill("Left");
await page.getByRole("button", { name: "+ Add choice" }).click();
await page.getByPlaceholder("Choice 2").fill("Right");
await page.getByLabel("Choice to write next").selectOption({ label: "Right" });
await page.getByRole("button", { name: "Post and write next" }).click();
await page.waitForURL(/\/c\/[^/]+\/write\?choice=/);
const root = /\/c\/([^/]+)\/write/.exec(page.url())[1];
const rootData = await json("GET", `/api/chapters/${root}`);
const right = rootData.choices.find((c) => c.label === "Right");
ok(page.url().endsWith(`choice=${right.id}`), "“Post and write next” posts, then opens the chosen choice for writing");
ok((await page.getByLabel(/Choice text/).inputValue()) === "Right", "…with its choice text filled in");
const story = await json("GET", `/api/stories/${rootData.chapter.story_id}`);
ok(story.style === "STYLE-NEW: first person.", "the style notes are saved with the story");

// ---- editing the style notes while writing ----
const fold = page.locator("summary", { hasText: "Style notes" });
ok((await fold.innerText()).includes("STYLE-NEW"), "the writing page shows the story's style notes, folded");
await fold.click();
await page.getByLabel(/For the whole story/).fill("STYLE-EDITED: third person.");
ok((await fold.innerText()).includes("not saved"), "a change is marked as not saved");
ok(await page.getByText(/style notes changes aren.t saved to the story/).isVisible(), "…and the Finish section says posting won't save it");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok(lastChapterPrompt().includes("STYLE-EDITED: third person.") && !lastChapterPrompt().includes("STYLE-NEW"), "an unsaved change is used for drafting on this page");
ok((await json("GET", `/api/stories/${story.id}`)).style === "STYLE-NEW: first person.", "…without changing the story yet");

await page.waitForTimeout(1000); // the draft's save
await page.reload();
await page.getByLabel(/For the whole story/).waitFor();
ok((await page.getByLabel(/For the whole story/).inputValue()) === "STYLE-EDITED: third person.", "the unsaved change is kept with the draft over a reload");
await page.getByRole("button", { name: "Discard changes" }).click();
ok((await page.getByLabel(/For the whole story/).inputValue()) === "STYLE-NEW: first person.", "discarding goes back to the story's notes");
await page.getByLabel(/For the whole story/).fill("STYLE-EDITED: third person.");
await page.getByRole("button", { name: "Save for the story" }).click();
await page.getByText("Saved for the whole story.").waitFor();
ok((await json("GET", `/api/stories/${story.id}`)).style === "STYLE-EDITED: third person.", "saving stores it on the story");
ok(!(await fold.innerText()).includes("not saved"), "…and it's no longer marked as unsaved");

// ---- one choice: no picker, straight on ----
await page.getByPlaceholder("Choice 1").fill("Onward");
ok(!(await page.getByLabel("Choice to write next").isVisible()), "with one choice there is nothing to pick");
await page.getByRole("button", { name: "Post and write next" }).click();
await page.waitForURL((u) => u.href.includes("/write?choice=") && !u.href.endsWith(right.id));
ok((await page.getByLabel(/Choice text/).inputValue()) === "Onward", "…and it goes on to that choice");
await page.getByRole("button", { name: "Generate chapter" }).click();
await page.getByRole("button", { name: "Edit text" }).waitFor();
ok(lastChapterPrompt().includes("STYLE-EDITED: third person."), "a later chapter's prompt uses the saved notes");

// ---- plain post still goes to the chapter ----
await page.getByRole("button", { name: "Post chapter" }).click();
await page.waitForURL(/\/c\/[^/]+\?posted=1/);
ok(true, "“Post chapter” still opens the posted chapter");

await json("PUT", "/api/settings", settingsBefore ?? {});
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);
