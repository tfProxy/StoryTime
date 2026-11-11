import { launch, useMockAi } from "./browser.mjs";
import { unfoldEntryFolds } from "./unfold.mjs";

// An entry's normal (base) form: the entry page says which it is and that the AI isn't told it, and warns when facts are
// for a form but no form is set. What the AI reads follows (see tests/unit/codex.test.mts for the rules).
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
try {
  const story = await post("/api/stories", { title: "Form Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go on"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's ears changed.", choices: [] })).chapter_id;
  const mk = async (name) => (await post("/api/codex", { anchor_chapter_id: R, op: "create", name, type: "character" })).entry_id;
  const fact = (entry_id, anchor_chapter_id, aspect, text, form = "") => post("/api/codex/facts", { anchor_chapter_id, entry_id, op: "set", aspect, form, text });

  // Rowan: human at the start (the normal form), a vixen at chapter A
  const rowan = await mk("Rowan");
  await fact(rowan, R, "Ears", "round ears");
  await fact(rowan, R, "Tail", "no tail", "human");
  await fact(rowan, R, "Tail", "a bushy tail", "vixen");
  await fact(rowan, R, "form", "", "human");
  await fact(rowan, A, "form", "", "vixen");
  // Wren: facts of a form, but no form ever set
  const wren = await mk("Wren");
  await fact(wren, R, "Tail", "a bushy tail", "vixen");

  const context = await browser.newContext();
  await unfoldEntryFolds(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  const at = (id, chapter) => `${BASE}/s/${sid}/codex/${id}?at=${chapter}`;
  const form = () => page.locator(".ef-form-row");
  const reads = () => page.locator(".entry-ai-told .fact-ai");

  // in the normal form: said on the page, and the AI isn't told the form
  await page.goto(at(rowan, R));
  await form().getByText(/human is the normal form/).waitFor();
  ok(true, "in its normal form the page says so");
  ok((await reads().innerText()).includes("Tail: no tail") && !(await reads().innerText()).includes("Form:"), "…the AI reads its facts but not the form: " + (await reads().innerText()));

  // another form: told to the AI
  await page.goto(at(rowan, A));
  await form().getByText(/normal form: human/).waitFor();
  ok((await reads().innerText()).includes("\n  - Form: vixen.\n") && (await reads().innerText()).includes("a bushy tail"), "in another form the AI is told it: " + (await reads().innerText()));

  // facts of a form, no form set
  await page.goto(at(wren, R));
  await page.getByText(/no form is set, so the AI isn't sent them/).waitFor();
  ok(true, "facts of a form with no form set are flagged");
  ok(!(await reads().innerText()).includes("bushy tail"), "…and indeed not read by the AI");
  await page.goto(at(rowan, R));
  ok((await page.getByText(/no form is set, so the AI isn't sent them/).count()) === 0, "an entry with a form isn't flagged");
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
