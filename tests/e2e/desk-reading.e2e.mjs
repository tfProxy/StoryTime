// Reading on the writing desk: "Stop editing" beside the box's title shows the chapter's text (with its pictures) in
// place of the box, with ✎ to edit it again; a written choice followed while reading opens its chapter read too, while
// one followed while editing opens it to edit. On a new chapter, Stop editing reads the chapter it follows.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// Root -> Gate (header picture) -> Market; Gate has an unwritten choice too.
const story = await post("/api/stories", { title: "Desk Reading", premise: "p", chapter: { title: "Root", body: "It began.", choices: ["Go"] } });
const root = story.chapter_id;
const gate = (await post("/api/chapters", { choice_id: (await get(`/api/chapters/${root}`)).choices[0].id, title: "The Gate", body: "Mira reached the gate.\n\nIt was shut.", choices: ["Knock", "Wait"] })).chapter_id;
const [knock, wait] = (await get(`/api/chapters/${gate}`)).choices;
const market = (await post("/api/chapters", { choice_id: knock.id, title: "The Market", body: "Stalls everywhere.", choices: ["On"] })).chapter_id;
await fetch(`${BASE}/api/chapters/${gate}/images/header`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
const drafts = [`edit:${gate}`, `edit:${market}`, `edit:${root}`, `fill:${wait.id}`];

const browser = await launch();
try {
  for (const width of [1280, 390]) {
    const at = `(${width}px)`;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
    const box = page.getByRole("region", { name: "The chapter" });
    const title = page.getByRole("textbox", { name: "Chapter title" });
    // On a phone "What happens next?" is a sheet opened from the bottom bar.
    const choices = async () => {
      if (width < 700) await page.getByRole("button", { name: /^Next/ }).click();
      return page.getByRole("region", { name: "What happens next?" });
    };

    // ---- editing: Stop editing beside the title ----
    await page.goto(`${BASE}/c/${gate}/desk`);
    await title.waitFor();
    const stop = box.getByRole("link", { name: "Stop editing" });
    ok(await stop.isVisible(), `the box has Stop editing ${at}`);
    // Both measured at once: the desk scrolls to the box as its draft loads.
    const [t, s] = await page.evaluate(() =>
      ["#chapter-title", ".desk-stop"].map((q) => {
        const r = document.querySelector(q).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    ok(Math.abs(t.y + t.height / 2 - (s.y + s.height / 2)) < 6 && s.x > t.x + t.width - 2, `…at the right of the title ${at}`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `the box fits the screen ${at}`);

    // ---- reading ----
    await stop.click();
    await page.waitForURL(`**/c/${gate}/desk?read=1`);
    await box.getByRole("heading", { name: "The Gate" }).waitFor();
    ok((await title.count()) === 0, `reading, the box gives way to the chapter's text ${at}`);
    ok((await box.innerText()).includes("It was shut."), `…which shows the chapter's text ${at}`);
    ok((await box.locator("img.chapter-image-header").count()) === 1, `…with its pictures ${at}`);
    ok(await box.getByRole("link", { name: "Edit “The Gate”" }).isVisible(), `…and ✎ to edit it ${at}`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `the chapter read fits the screen ${at}`);

    // A written choice followed while reading opens its chapter read.
    await (await choices()).getByRole("link", { name: /Knock/ }).click();
    await page.waitForURL(`**/c/${market}/desk?read=1`);
    await box.getByRole("heading", { name: "The Market" }).waitFor();
    ok((await title.count()) === 0, `a written choice followed while reading opens its chapter read ${at}`);

    // ✎ starts editing it; a written choice followed while editing opens its chapter to edit (as before).
    await box.getByRole("link", { name: "Edit “The Market”" }).click();
    await page.waitForURL(`**/c/${market}/desk`);
    await title.waitFor();
    ok((await title.inputValue()) === "The Market", `✎ starts editing the chapter ${at}`);
    await page.goto(`${BASE}/c/${gate}/desk`);
    await title.waitFor();
    await (await choices()).getByRole("link", { name: /Knock/ }).click();
    await page.waitForURL(`**/c/${market}/desk`);
    await title.waitFor();
    ok((await title.inputValue()) === "The Market", `a written choice followed while editing opens its chapter to edit ${at}`);

    // ---- a new chapter: Stop editing reads the chapter it follows ----
    await page.goto(`${BASE}/c/${gate}/desk?choice=${wait.id}`);
    await title.waitFor();
    await box.getByRole("link", { name: "Stop editing" }).click();
    await page.waitForURL(`**/c/${gate}/desk?read=1`);
    await box.getByRole("heading", { name: "The Gate" }).waitFor();
    ok(true, `on a new chapter, Stop editing reads the chapter it follows ${at}`);
    await page.close();
  }
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  for (const key of drafts) await fetch(`${BASE}/api/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  await browser.close();
}
process.exit(failed ? 1 : 0);
