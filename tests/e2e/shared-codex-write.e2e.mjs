import { launch, useMockAi } from "./browser.mjs";

// A shared entry added from the writing page's drawer is held in the draft (it shows, with its facts, before the
// chapter is posted) and is linked at the new chapter when the chapter is posted.
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE, { main: "m", cheap: null });
const browser = await launch();
try {
  const story = await post("/api/stories", { title: "Drawer Shared", premise: "p", chapter: { title: "Root", body: "It began.", choices: ["Go on"] } });
  const root = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${root}`)).choices[0];
  const shared = (await post("/api/shared", { name: "Wren Ashby", type: "character", content: "Base notes." })).id;
  await post(`/api/shared/${shared}/facts`, { aspect: "Hair", text: "silver braid" });
  const codexAt = async (id) => (await send("GET", `/api/chapters/${id}/codex`)).entries;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/c/${root}/write?choice=${choice.id}`);
  await page.locator(".site-menu > summary").click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const drawer = page.locator("aside.codex-drawer");
  await drawer.waitFor();

  await drawer.getByRole("button", { name: "+ Shared entry" }).click();
  ok((await drawer.getByLabel("Appears from").inputValue()) === "draft", "in the drawer it is added to the chapter being written by default");
  await drawer.getByRole("button", { name: "Add to the codex" }).click();
  const card = drawer.locator(".entry-card", { hasText: "Wren Ashby" });
  await card.waitFor();
  const text = await card.innerText();
  ok(text.includes("shared") && text.includes("Hair: silver braid"), "the held entry shows in the drawer with the shared entry's facts: " + text.replace(/\n/g, " | "));
  ok(!(await codexAt(root)).some((e) => e.name === "Wren Ashby"), "nothing is saved before the chapter is posted");

  // its page in the drawer: read-only details, and a fact can be changed for the draft
  await card.click();
  await drawer.getByRole("heading", { name: "Wren Ashby" }).waitFor();
  ok(await drawer.getByText(/This entry is shared/).isVisible(), "the entry says it is shared");
  await drawer.getByRole("button", { name: "← All entries" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByLabel("Chapter title").fill("Wren");
  await page.getByLabel("Chapter text").fill("Wren arrived with a silver braid.");
  // The Finish section opens once the chapter has text.
  await page.getByLabel(/^Summary/).fill("Wren arrives.");
  await page.getByRole("button", { name: "Post chapter" }).click();
  await page.waitForURL(/\/c\/[^/]+(\/summary)?\?/);
  const posted = /\/c\/([^/?]+)/.exec(page.url())[1];
  const wren = (await codexAt(posted)).find((e) => e.name === "Wren Ashby");
  ok(wren && wren.shared_entry_id === shared && wren.description === "Hair: silver braid.", "posting links the shared entry at the new chapter: " + JSON.stringify(wren?.description));
  ok(!(await codexAt(root)).some((e) => e.name === "Wren Ashby"), "…and not at the chapter before it");
  await post(`/api/shared/${shared}/facts`, { aspect: "Eyes", text: "grey" });
  ok((await codexAt(posted)).find((e) => e.name === "Wren Ashby").description === "Hair: silver braid.\nEyes: grey.", "…and it follows the shared entry afterwards");
  await send("DELETE", `/api/stories/${story.story_id}`);
  await context.close();
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
