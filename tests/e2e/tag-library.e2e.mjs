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
    const system = body.messages[0].content, user = body.messages.at(-1).content;
    calls.push({ system, user });
    let out;
    if (system.includes("help an author write a precise rule")) {
      out = { name: "Shapeshift", applies: "A character visibly changes species on the page.", not_applies: "dreams; disguises", choices: ["partial", "full"] };
    } else if (user.includes('Chapter to read: "Horse"')) {
      out = { tags: [{ name: "Shapeshift", value: "full", quote: "Mira had turned into a horse.", reason: "She changes species." }] };
    } else {
      out = { tags: [] };
    }
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const getJson = async (url) => (await fetch(BASE + url)).json();

const story = await post("/api/stories", { title: "Tag trial", chapter: { title: "Start", body: "Mira stood in the market.", choices: ["Onward"] } });
const choice = (await getJson(`/api/chapters/${story.chapter_id}`)).choices[0];
await post("/api/chapters", { choice_id: choice.id, title: "Horse", body: "Mira had turned into a horse." });

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
const card = (name) => page.locator(`article.card[data-tag="${name}"]`);

try {
  await page.goto(`${BASE}/settings#tags`);
  const lib = page.getByRole("region", { name: "Tags" });
  await lib.getByRole("heading", { name: "Tags" }).waitFor();

  // ---- check chapters automatically ----
  const auto = lib.getByRole("checkbox", { name: /Check new and edited chapters automatically/ });
  await auto.waitFor();
  ok(!(await auto.isChecked()), "Check new and edited chapters automatically is off by default");
  ok(await lib.getByText("Results wait on the Review page.").isVisible(), "…with its note under it");
  await auto.check();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings?.autoReview === true);
  await page.reload();
  await lib.getByRole("heading", { name: "Tags" }).waitFor();
  ok(await lib.getByRole("checkbox", { name: /Check new and edited chapters automatically/ }).isChecked(), "…and stays on after a reload");
  await lib.getByRole("checkbox", { name: /Check new and edited chapters automatically/ }).uncheck();
  await page.waitForFunction(async () => (await (await fetch("/api/settings")).json()).settings?.autoReview === false);

  // ---- by hand ----
  await lib.getByPlaceholder(/tf: a character/).fill("violence: someone is hurt");
  await lib.getByRole("button", { name: "Write it myself" }).click();
  const form = lib.locator('article.card[data-tag="new"]');
  ok((await form.getByLabel("Name", { exact: true }).inputValue()) === "violence", "Write it myself takes the name from before the colon");
  await form.getByLabel("Applies when").fill("A character is hurt on the page.\nSecond line.");
  await form.getByLabel("Values").fill("mild, graphic");
  await form.getByRole("button", { name: "Save tag" }).click();
  await card("violence").waitFor();
  ok((await card("violence").innerText()).includes("A character is hurt on the page."), "list shows name and first line of the rule");

  // ---- edit and save ----
  const v = card("violence");
  await v.getByLabel("Doesn't apply when").fill("only mentioned");
  await v.getByLabel("Values").fill("mild, graphic, gory");
  await v.getByRole("button", { name: "Save", exact: true }).click();
  await v.getByText("Saved.", { exact: true }).waitFor();
  const saved = (await getJson("/api/tags")).tags.find((t) => t.name === "violence");
  ok(saved.not_applies === "only mentioned" && saved.choices.join() === "mild,graphic,gory", "edit saved on the server");

  // ---- duplicate name ----
  await lib.getByPlaceholder(/tf: a character/).fill("Violence: again");
  await lib.getByRole("button", { name: "Write it myself" }).click();
  await form.getByRole("button", { name: "Save tag" }).click();
  await form.getByText(/already a tag with that name/).waitFor();
  ok(true, "duplicate name shows an error inline");
  await form.getByRole("button", { name: "Cancel" }).click();

  // ---- examples can be removed ----
  await fetch(`${BASE}/api/tags/${saved.id}/examples`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "He slapped the table.", applies: false, note: "no one hurt" }) });
  await page.reload();
  await card("violence").getByRole("button", { name: /violence/ }).click();
  await card("violence").getByText("He slapped the table.").waitFor();
  ok(await card("violence").getByText("doesn't count").isVisible(), "example shows whether it counts");
  await card("violence").getByRole("button", { name: "Remove" }).click();
  await card("violence").getByText("He slapped the table.").waitFor({ state: "detached" });
  ok((await getJson("/api/tags")).tags.find((t) => t.id === saved.id).examples.length === 0, "removing an example saves");

  // ---- Help me write it ----
  const helpBox = lib.getByPlaceholder(/tf: a character/);
  await helpBox.fill("tf: a character changes species");
  const before = calls.length;
  await lib.getByRole("button", { name: "Help me write it" }).click();
  await form.waitFor();
  ok(calls.length - before === 1, "one AI call");
  ok((await form.getByLabel("Name", { exact: true }).inputValue()) === "Shapeshift", "name filled from the AI reply");
  ok((await form.getByLabel("Applies when").inputValue()).startsWith("A character visibly changes"), "rule filled from the AI reply");
  ok((await form.getByLabel("Values").inputValue()) === "partial, full", "values filled from the AI reply");
  ok((await getJson("/api/tags")).tags.every((t) => t.name !== "Shapeshift"), "nothing saved yet");

  // ---- Try it (unsaved) ----
  await form.getByLabel("Story to try it on").selectOption({ label: "Tag trial" });
  await form.getByRole("button", { name: "Try it", exact: true }).click();
  await form.getByText("tagged (full)").waitFor();
  ok(await form.getByText("Mira had turned into a horse.").isVisible(), "tagged chapter shows its quote");
  ok(await form.getByText("She changes species.").isVisible(), "…and the reason");
  ok(await form.getByText("not tagged").isVisible(), "other chapter is not tagged");
  ok((await getJson("/api/tags")).tags.every((t) => t.name !== "Shapeshift"), "Try it saved nothing");
  await form.getByRole("button", { name: "Save tag" }).click();
  await card("Shapeshift").waitFor();

  // ---- delete ----
  for (const name of ["Shapeshift", "violence"]) {
    const c = card(name);
    if (!(await c.getByRole("button", { name: "Delete" }).isVisible())) await c.getByRole("button", { name: new RegExp(name) }).click();
    await c.getByRole("button", { name: "Delete" }).click();
    await c.waitFor({ state: "detached" });
  }
  ok((await getJson("/api/tags")).tags.length === 0, "tags deleted");
} catch (e) {
  console.log("FAIL", e.message);
  failed = true;
} finally {
  for (const t of (await getJson("/api/tags")).tags) await fetch(`${BASE}/api/tags/${t.id}`, { method: "DELETE" });
  await browser.close(); mock.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
