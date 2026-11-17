// The writing desk's path shows each earlier chapter's pictures: folded, an icon for each on the block's head (it shows
// the picture full screen); unfolded, the pictures in its text where the reading page puts them.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const putPicture = (chapter, slot) => fetch(`${BASE}/api/chapters/${chapter}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });

// Root (header + middle + footer) -> Plain (none) -> Last (on the desk)
const story = await post("/api/stories", { title: "Desk Pictures", premise: "p", chapter: { title: "Root", body: "One.\n\nTwo.\n\nThree.\n\nFour.", choices: ["Go"] } });
const root = story.chapter_id;
const next = async (from, title) => (await post("/api/chapters", { choice_id: (await get(`/api/chapters/${from}`)).choices[0].id, title, body: `${title}.`, choices: ["On"] })).chapter_id;
const plain = await next(root, "Plain");
const last = await next(plain, "Last");
for (const slot of ["header", "middle", "footer"]) await putPicture(root, slot);

const browser = await launch();
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
    await page.goto(`${BASE}/c/${last}/desk`);
    // On a phone the path is a sheet opened from the bottom bar.
    if (width < 700) await page.getByRole("button", { name: "Path", exact: true }).click();
    const rootBlock = page.getByRole("article", { name: "Chapter 1: Root" });
    const plainBlock = page.getByRole("article", { name: "Chapter 2: Plain" });
    await rootBlock.waitFor();
    const at = `(${width}px)`;
    for (const name of ["header", "middle", "footer"]) ok(await rootBlock.getByRole("button", { name: `Show the ${name} picture` }).isVisible(), `folded, Root's head has its ${name} picture icon ${at}`);
    ok((await plainBlock.locator(".desk-block-picture").count()) === 0, `a chapter without pictures has no icons ${at}`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `the path fits the screen ${at}`);

    await rootBlock.getByRole("button", { name: "Show the middle picture" }).click();
    const full = page.locator("dialog.chapter-image-full");
    await full.waitFor();
    ok((await full.locator("img").getAttribute("src")).includes(`/api/chapters/${root}/images/middle`), `the icon shows that picture full screen ${at}`);
    await page.keyboard.press("Escape");
    await full.waitFor({ state: "detached" });

    await rootBlock.locator(".desk-block-fold").click();
    const text = rootBlock.locator(".desk-block-text");
    await text.waitFor();
    ok((await rootBlock.locator(".desk-block-picture").count()) === 0, `unfolded, the icons give way to the pictures ${at}`);
    const order = await text.evaluate((el) =>
      [...el.querySelectorAll("img.chapter-image, p")].map((n) => (n.tagName === "IMG" ? n.className.replace(/.*chapter-image-/, "") : n.textContent.trim())).join(" "),
    );
    ok(order === "header One. Two. middle Three. Four. footer", `the pictures sit where the reading page puts them: ${order} ${at}`);
    await page.close();
  }
} catch (e) {
  console.log("ERROR", e);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
