import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const user = body.messages.at(-1).content;
    calls.push({ model: body.model, user });
    const out = user.includes('Chapter to read: "Horse"')
      ? { tags: [{ name: TAG, value: "full", quote: "Mira had turned into a horse.", reason: "She changes species." }] }
      : { tags: [] };
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

const TAG = `Shift ${Date.now()}`;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const post = (url, body) => send("POST", url, body);
const horseCalls = () => calls.filter((c) => c.user.includes('Chapter to read: "Horse"')).length;

const plain = await post("/api/stories", { title: "Untagged story", chapter: { title: "Only", body: "Nothing here.", choices: [] } });
const tag = await post("/api/tags", { name: TAG, applies: "A character visibly changes species.", not_applies: "dreams", kind: "event", choices: ["partial", "full"] });
const tagId = tag.tag?.id ?? tag.id;
const s = await post("/api/stories", { title: "Tagging trial", chapter: { title: "Start", body: "Mira stood in the market.", summary: "s", choices: ["Onward"] } });
const choice = (await send("GET", `/api/chapters/${s.chapter_id}`)).choices[0];
const horse = (await post("/api/chapters", { choice_id: choice.id, title: "Horse", body: "Mira had turned into a horse.", summary: "h" })).chapter_id;

const browser = await launch();
const ai = await useMockAi(BASE);
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
const reviewUrl = (id, q = "") => `${BASE}/s/${id}/review${q}`;

try {
  // Every tag is on for a story by default; the author can switch one off, on the Review page or on the details page.
  const enabledFor = async (id) => (await send("GET", `/api/stories/${id}/tags`)).enabled;
  const tagBox = () => page.getByRole("checkbox", { name: new RegExp(TAG) });
  ok((await enabledFor(plain.story_id)).includes(tagId), "a new tag is on for a story that existed before it");
  await page.goto(reviewUrl(plain.story_id, "?tab=tags"));
  const summary = page.locator("summary", { hasText: "Tags in this story" });
  ok((await summary.innerText()).includes(TAG), "the Tags tab names the tags that are on");
  ok(!(await tagBox().isVisible()), "…so the switches are folded away");
  await summary.click();
  ok(await tagBox().isChecked(), "…and opening them shows the tag ticked");
  ok(await page.getByText("A character visibly changes species.").isVisible(), "…with the first line of its rule as a hint");
  await tagBox().uncheck();
  await page.waitForFunction(async ([id, tid]) => !(await (await fetch(`/api/stories/${id}/tags`)).json()).enabled.includes(tid), [plain.story_id, tagId]);
  ok(!(await enabledFor(plain.story_id)).includes(tagId), "unticking on the Review page switches it off");
  ok((await enabledFor(s.story_id)).includes(tagId), "…for that story only");

  await page.goto(`${BASE}/s/${plain.story_id}/details`);
  ok(await page.getByRole("heading", { name: "Tags in this story" }).isVisible(), "the details page has a Tags card");
  ok(!(await tagBox().isChecked()), "…showing the tag off");
  await tagBox().check();
  await page.waitForFunction(async ([id, tid]) => (await (await fetch(`/api/stories/${id}/tags`)).json()).enabled.includes(tid), [plain.story_id, tagId]);
  ok((await enabledFor(plain.story_id)).includes(tagId), "ticking on the details page switches it on");
  await page.goto(reviewUrl(plain.story_id, "?tab=tags"));
  ok((await summary.innerText()).includes(TAG), "…and the Review page agrees");
  await summary.click();
  await tagBox().uncheck();
  await page.waitForFunction(async ([id, tid]) => !(await (await fetch(`/api/stories/${id}/tags`)).json()).enabled.includes(tid), [plain.story_id, tagId]);
  await page.goto(`${BASE}/s/${plain.story_id}/details`);
  ok(!(await tagBox().isChecked()), "…and so does the details page after unticking on Review");

  // Tabs.
  await page.goto(reviewUrl(s.story_id));
  ok((await page.getByRole("link", { name: "Issues" }).getAttribute("aria-current")) === "page", "Issues is the default tab");
  ok(await page.getByRole("heading", { name: "Summaries" }).isVisible(), "…and shows the summaries");
  await page.getByRole("link", { name: "Tags", exact: true }).click();
  await page.waitForURL(/tab=tags/);
  ok((await page.getByRole("link", { name: "Tags", exact: true }).getAttribute("aria-current")) === "page", "the Tags tab opens");
  ok(await page.getByText("Nothing is waiting for your decision.").isVisible(), "nothing waits at first");

  // Find tags for the whole story.
  await page.getByRole("button", { name: "Find tags" }).click();
  await page.getByText(/found 1 new suggestion/).waitFor();
  ok(calls.length === 2, "one AI call per chapter");
  ok(calls.every((c) => c.model === "cheap"), "the whole story uses the cheap model");
  const sug = page.locator("article[data-chapter-tag]");
  await sug.waitFor();
  ok((await sug.count()) === 1, "a suggestion appears");
  ok((await sug.innerText()).includes("Mira had turned into a horse.") && (await sug.innerText()).includes(`${TAG}: full`), "it shows the tag, value and quote");

  // Outline marker.
  await page.goto(`${BASE}/s/${s.story_id}/outline`);
  const marker = page.locator("a.outline-review");
  ok((await marker.count()) === 1 && (await marker.innerText()).trim() === "⚠ 1", "the outline marks the chapter with the suggestion");
  ok((await marker.getAttribute("href")) === `/s/${s.story_id}/review?tab=tags&chapter=${horse}`, "…linking to the tags tab");
  await marker.click();
  await page.waitForURL(/tab=tags/);

  // Approve.
  await page.getByRole("button", { name: "Approve" }).click();
  await page.locator("article[data-chapter-tag]").waitFor({ state: "detached" });
  ok(true, "approving removes it from Waiting");
  await page.getByRole("button", { name: /^Remove .* from Horse$/ }).waitFor();
  ok((await page.locator("article[data-tagged-chapter]").innerText()).includes(`${TAG}: full`), "it appears under Tagged");

  // A second run skips the decided chapter.
  const before = horseCalls();
  await page.getByRole("radio", { name: /The whole story/ }).check();
  await page.getByRole("button", { name: "Find tags" }).click();
  await page.getByText(/skipped/).waitFor();
  ok(horseCalls() === before, "the decided chapter is not read again");
  ok(await page.getByText(/1 chapter was skipped/).isVisible(), "it says how many were skipped");

  // Reject and add as example (a suggestion posted directly on the first chapter).
  const startRev = 1;
  await post(`/api/chapters/${s.chapter_id}/tags/suggest`, {
    revision: startRev,
    checked_tag_ids: [tagId],
    suggestions: [{ tag_id: tagId, value: null, quote: "stood in the market", reason: "Not a change." }],
  });
  await page.goto(reviewUrl(s.story_id, "?tab=tags"));
  await page.getByRole("button", { name: "Reject and add as example" }).click();
  await page.getByText("1 rejected suggestion is hidden.").waitFor();
  const lib = (await send("GET", "/api/tags")).tags;
  const mine = lib.find((t) => t.id === tagId);
  ok(mine.examples.some((e) => e.text === "stood in the market" && e.applies === false), "the tag's examples grew");

  // By hand, then remove.
  await page.goto(reviewUrl(s.story_id, `?tab=tags&chapter=${s.chapter_id}`));
  await page.getByRole("button", { name: "Add a tag" }).click();
  await page.getByRole("button", { name: /^Remove .* from Start$/ }).waitFor();
  ok(true, "a tag added by hand shows up");
  await page.getByRole("button", { name: /^Remove .* from Start$/ }).click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label$="from Start"]'));
  ok(true, "× removes it");

  // Switched off: not offered by hand and not looked for.
  await send("PUT", `/api/stories/${s.story_id}/tags`, { tag_id: tagId, on: false });
  await page.goto(reviewUrl(s.story_id, `?tab=tags&chapter=${s.chapter_id}`));
  ok((await page.locator("select option", { hasText: TAG }).count()) === 0, "a switched-off tag is not offered under Add a tag");
  const findButton = page.getByRole("button", { name: "Find tags" });
  if (await findButton.isVisible()) {
    const seen = calls.length;
    await findButton.click();
    await page.waitForTimeout(1500);
    ok(calls.slice(seen).every((c) => !c.user.includes(TAG)), "…and Find tags does not ask the AI about it");
  } else {
    ok(true, "…and Find tags is hidden when every tag is off");
  }
} finally {
  await send("DELETE", `/api/tags/${tagId}`);
  await ai.restore();
  await browser.close();
  mock.close();
}
process.exit(failed ? 1 : 0);
