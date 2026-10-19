// The story list shows covers in a grid, with a generated cover until one is uploaded, and the
// New story button sits in the bottom-right corner.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const titles = ["Cover one", "Cover two", "Cover three", "Cover four"];
const ids = [];
for (const title of titles) ids.push((await post("/api/stories", { title, premise: `About ${title}`, chapter: { title: "Root", body: "b" } })).story_id);

// a 40x60 PNG made in the browser, uploaded through the details page
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

await page.goto(BASE);
const card = (title) => page.locator(".story-card", { hasText: title });
const box = async (loc) => loc.boundingBox();

// ---- the grid ----
const boxes = await Promise.all(titles.map((t) => box(card(t))));
ok(boxes.every((b) => b && b.height > b.width), "each story is a tall, book-shaped card");
ok(new Set(boxes.map((b) => Math.round(b.y))).size < boxes.length, "stories sit side by side in a grid");
ok((await card("Cover one").locator(".cover svg").count()) === 1 && (await card("Cover one").locator(".cover img").count()) === 0, "with no cover uploaded, a generated cover is shown");
const svgOf = async (t) => card(t).locator(".cover svg").innerHTML();
ok((await svgOf("Cover one")) === (await svgOf("Cover one")) && (await svgOf("Cover one")) !== (await svgOf("Cover two")), "…different for each story");
ok((await card("Cover one").getByText("1 chapter", { exact: true }).isVisible()), "the title and chapter count sit under the cover");

// ---- New story, bottom right ----
const fab = page.getByRole("link", { name: /New story/ });
const f = await box(fab), vp = page.viewportSize();
ok(f.x + f.width > vp.width * 0.7 && f.y + f.height > vp.height * 0.7, "the New story button is in the bottom-right corner");
await page.mouse.wheel(0, 2000);
ok(Math.abs((await box(fab)).y - f.y) < 1, "…and stays there when the page scrolls");

// ---- menus open inside the window, even for the first and last column ----
for (const t of ["Cover one", "Cover four"]) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await card(t).locator("summary").click();
  const inside = await page
    .waitForFunction((title) => {
      const r = [...document.querySelectorAll(".story-card")].find((c) => c.textContent.includes(title))?.querySelector(".story-menu-items")?.getBoundingClientRect();
      return !!r && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth;
    }, t, { timeout: 2000 })
    .then(() => true, () => false);
  ok(inside, `“${t}”'s menu stays inside the window`);
  await card(t).locator("summary").click();
}

// ---- upload a cover ----
await page.goto(`${BASE}/s/${ids[1]}/details`);
ok(await page.getByRole("button", { name: "Upload cover" }).isVisible(), "the details page offers to upload a cover");
const png = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 40; c.height = 60;
  const g = c.getContext("2d");
  g.fillStyle = "#e11"; g.fillRect(0, 0, 40, 60);
  return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()));
});
await page.getByLabel("Cover image file").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: Buffer.from(png) });
await page.getByText("Cover saved.").waitFor();
ok(await page.getByRole("button", { name: "Replace cover" }).isVisible(), "after uploading, the button says Replace");
const stored = await fetch(`${BASE}/api/stories/${ids[1]}/cover`);
ok(stored.status === 200 && stored.headers.get("content-type") === "image/jpeg", "the cover is stored (as a JPEG)");

await page.goto(BASE);
ok((await card("Cover two").locator(".cover img").count()) === 1 && (await card("Cover two").locator(".cover svg").count()) === 0, "the list shows the uploaded cover for that story");
ok((await card("Cover two").locator(".cover img").evaluate((i) => i.complete && i.naturalWidth)) === 40, "…and the picture loads");
ok((await card("Cover three").locator(".cover svg").count()) === 1, "…while other stories keep their generated cover");

// a file that isn't a picture is turned down
await page.goto(`${BASE}/s/${ids[2]}/details`);
await page.getByLabel("Cover image file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
await page.getByText(/isn't an image/).waitFor();
ok(true, "a file that isn't an image is turned down");
ok((await fetch(`${BASE}/api/stories/${ids[2]}/cover`)).status === 404, "…and nothing is stored");

// remove it again
await page.goto(`${BASE}/s/${ids[1]}/details`);
await page.getByRole("button", { name: "Remove cover" }).click();
await page.getByText("Cover removed.").waitFor();
await page.goto(BASE);
ok((await card("Cover two").locator(".cover svg").count()) === 1, "removing the cover brings back the generated one");

await browser.close();
process.exit(failed ? 1 : 0);
