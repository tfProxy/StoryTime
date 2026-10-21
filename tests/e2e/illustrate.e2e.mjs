// Chapter illustrations: upload a header and a footer picture from the chapter's menu, see them where the
// chapter is read (and on the path page), refuse non-images, and remove one again.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (url) => (await fetch(BASE + url)).json();

const story = await post("/api/stories", {
  title: "Illustrated tale",
  chapter: { title: "Pictured root", body: "The first paragraph of the root.\n\nThe second paragraph of the root.", choices: ["Onward"] },
});
const root = story.chapter_id;
const choice = (await get(`/api/chapters/${root}`)).choices[0];
const child = (await post("/api/chapters", { choice_id: choice.id, title: "Plain child", body: "Nothing to see here." })).chapter_id;

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });

// an 80x50 PNG made in the browser
const png = Buffer.from(
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 80; c.height = 50;
    const g = c.getContext("2d");
    g.fillStyle = "#1a7"; g.fillRect(0, 0, 80, 50);
    return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()));
  }),
);

const loaded = (loc) => loc.evaluate((i) => i.complete && i.naturalWidth > 0);
const stored = (slot, id = root) => fetch(`${BASE}/api/chapters/${id}/images/${slot}`);
const card = (title) => page.locator(".image-editor", { has: page.getByRole("heading", { name: title }) });
// A card's buttons are in its ☰ menu: the names of the items it offers now.
const menuItems = async (title) => {
  await card(title).getByRole("button", { name: "More" }).click();
  const names = await card(title).getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  return names.map((n) => n.trim());
};
const choose = async (title, name) => {
  await card(title).getByRole("button", { name: "More" }).click();
  await card(title).getByRole("menuitem", { name }).click();
};

// ---- a chapter starts with no pictures ----
await page.goto(`${BASE}/c/${root}`);
ok((await page.locator(".chapter-image").count()) === 0, "a chapter with no pictures shows none");

// ---- from the chapter's menu to the illustrate page ----
await page.getByRole("link", { name: "Illustrate chapter", includeHidden: true }).waitFor({ state: "attached" });
await page.locator(".site-menu > summary").click();
await page.getByRole("link", { name: "Illustrate chapter" }).click();
await page.waitForURL(`**/c/${root}/illustrate`);
ok(await page.getByRole("heading", { name: "Header picture" }).isVisible() && await page.getByRole("heading", { name: "Footer picture" }).isVisible(), "the chapter's menu leads to the illustrate page, with a header and a footer picture");
ok((await menuItems("Header picture")).join("|") === "Upload picture", "each starts empty, with a ☰ menu that offers Upload only");

// ---- header ----
await page.getByLabel("Header picture file").setInputFiles({ name: "header.png", mimeType: "image/png", buffer: png });
await card("Header picture").getByText("Picture saved.").waitFor();
ok((await menuItems("Header picture")).join("|") === "Replace picture|Open in a new tab|Remove picture", "after uploading the header, the menu says Replace, and offers Open in a new tab and Remove");
ok((await menuItems("Footer picture")).join("|") === "Upload picture", "…and the footer is untouched");
const headerLink = card("Header picture").locator(".picture-frame > a");
ok(await headerLink.getAttribute("target") === "_blank" && (await headerLink.getAttribute("href")).includes(`/api/chapters/${root}/images/header`), "clicking the picture opens it in a new tab");
await card("Header picture").locator("img.image-editor-preview").waitFor();
await page.waitForFunction(() => { const i = document.querySelector(".image-editor img.image-editor-preview"); return !!i && i.complete && i.naturalWidth > 0; });
ok(await loaded(card("Header picture").locator("img.image-editor-preview")), "the preview shows the picture");
let r = await stored("header");
ok(r.status === 200 && r.headers.get("content-type") === "image/jpeg", "the header is stored (as a JPEG)");
ok((await stored("footer")).status === 404, "…and nothing is stored for the footer");

// ---- footer ----
await page.getByLabel("Footer picture file").setInputFiles({ name: "footer.png", mimeType: "image/png", buffer: png });
await card("Footer picture").getByText("Picture saved.").waitFor();
ok((await stored("footer")).headers.get("content-type") === "image/jpeg", "the footer is stored too");

// ---- where the chapter is read ----
await page.goto(`${BASE}/c/${root}`);
const header = page.locator("img.chapter-image.chapter-image-header");
const footer = page.locator("img.chapter-image.chapter-image-footer");
await header.waitFor();
await footer.waitFor();
await page.waitForFunction(() => [...document.querySelectorAll("img.chapter-image")].every((i) => i.complete && i.naturalWidth > 0));
ok((await loaded(header)) && (await loaded(footer)), "both pictures load on the chapter page");
const hb = await header.boundingBox(), h1 = await page.locator("h1").boundingBox();
ok(hb.y + hb.height <= h1.y + 1, "the header picture sits above the title");
const prose = await page.locator(".prose").boundingBox(), fb = await footer.boundingBox(), choices = await page.locator("section.choices").boundingBox();
ok(prose.y + prose.height <= fb.y + 1 && fb.y + fb.height <= choices.y + 1, "the footer picture sits between the text and the choices");

// ---- the path page shows the pictures of the chapters on the way ----
await page.goto(`${BASE}/c/${child}/path`);
const rootSection = page.locator(`#c-${root}`), childSection = page.locator(`#c-${child}`);
await rootSection.locator("img.chapter-image-header").waitFor();
await rootSection.locator("img.chapter-image-footer").waitFor();
await page.waitForFunction(() => [...document.querySelectorAll("img.chapter-image")].every((i) => i.complete && i.naturalWidth > 0));
const sh = await rootSection.locator("img.chapter-image-header").boundingBox(), st = await rootSection.locator("h2").boundingBox();
const sp = await rootSection.locator(".prose").boundingBox(), sf = await rootSection.locator("img.chapter-image-footer").boundingBox();
ok(sh.y + sh.height <= st.y + 1 && sp.y + sp.height <= sf.y + 1, "the path page shows the earlier chapter's pictures around its text");
ok((await childSection.locator("img").count()) === 0, "…and none for a chapter without any");

// ---- a file that isn't a picture is turned down ----
await page.goto(`${BASE}/c/${child}/illustrate`);
await page.getByLabel("Header picture file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
await card("Header picture").getByText(/isn't an image/).waitFor();
ok(true, "a file that isn't an image is turned down");
ok((await stored("header", child)).status === 404, "…and nothing is stored");
ok((await menuItems("Header picture")).includes("Upload picture"), "…the card still offers Upload");

// ---- remove the header ----
await page.goto(`${BASE}/c/${root}/illustrate`);
await card("Header picture").locator("img.image-editor-preview").waitFor();
await choose("Header picture", "Remove picture");
await card("Header picture").getByText("Picture removed.").waitFor();
ok((await menuItems("Header picture")).join("|") === "Upload picture", "removing the header brings back Upload");
ok((await stored("header")).status === 404 && (await stored("footer")).status === 200, "only the header is gone");
await page.goto(`${BASE}/c/${root}`);
await footer.waitFor();
ok((await page.locator("img.chapter-image-header").count()) === 0 && (await page.locator("img.chapter-image-footer").count()) === 1, "the chapter page shows only the footer picture");

await browser.close();
process.exit(failed ? 1 : 0);
