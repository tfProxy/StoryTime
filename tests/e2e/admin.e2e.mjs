import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const PASSWORD = process.env.ADMIN_PASSWORD;
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const status = async (url) => (await fetch(BASE + url)).status;

// Content to moderate: a story with an edited chapter.
const KEY = "e2e-admin-key-0123456789ab";
const s = await post("/api/stories", { title: "Moderation target", chapter: { title: "Offending chapter", author_name: "Troll", body: "something rude", edit_key: KEY, choices: ["on"] } });
const root = s.chapter_id;
const choice = (await (await fetch(`${BASE}/api/chapters/${root}`)).json()).choices[0];
const child = (await post("/api/chapters", { choice_id: choice.id, title: "Innocent child", body: "fine", author_name: "Ann" })).chapter_id;
await fetch(`${BASE}/api/chapters/${root}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edit_key: KEY, base_revision: 1, title: "Vandalised title", body: "much worse", edited_by: "Troll" }) });

const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

// ---- sign in ----
await page.goto(`${BASE}/admin`);
ok(await page.getByLabel("Admin password").isVisible() && (await page.getByRole("button", { name: "Remove" }).count()) === 0, "visitors only see the login form");
await page.getByLabel("Admin password").fill("not the password");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByText("Wrong password").waitFor();
ok(true, "wrong password shows an error");
await page.getByLabel("Admin password").fill(PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("button", { name: "Sign out" }).waitFor();
ok(true, "right password signs in");
ok(await page.getByText(/\d+ stories · \d+ chapters/).isVisible(), "stats are shown");

// ---- find and remove the offending chapter ----
await page.goto(`${BASE}/admin?story=${s.story_id}&kind=chapter`);
const offending = page.locator("article.card", { hasText: "Vandalised title" });
await offending.waitFor();
ok(await offending.getByText("much worse").isVisible() && await offending.getByText(/Troll/).first().isVisible() && await offending.locator("code").isVisible(), "rows show the title, preview, author and id");
await offending.getByRole("button", { name: "Remove" }).click();
await page.getByText(/Removed, hiding 1 chapter below it\./).waitFor();
ok(true, "remove reports the chapters hidden below");
ok((await status(`/c/${root}`)) === 404 && (await status(`/c/${child}`)) === 404, "the chapter and its child are hidden from readers");
ok((await page.locator("article.card", { hasText: "Vandalised title" }).getByText("REMOVED").count()) > 0, "the row is flagged as removed");

// ---- restore it, then revert the vandalism from the revisions list ----
await page.locator("article.card", { hasText: "Vandalised title" }).getByRole("button", { name: "Restore" }).click();
await page.getByText("Restored.").waitFor();
ok((await status(`/c/${root}`)) === 200 && (await status(`/c/${child}`)) === 200, "restore brings both back");
await page.locator("article.card", { hasText: "Vandalised title" }).getByRole("button", { name: "Revisions" }).click();
await page.getByText("Revision 1").waitFor();
ok(await page.getByText("something rude").isVisible(), "revisions show the earlier text");
await page.getByRole("button", { name: "Revert to this version" }).click();
await page.getByText("Reverted to revision 1.").waitFor();
const reverted = await (await fetch(`${BASE}/api/chapters/${root}`)).json();
ok(reverted.chapter.title === "Offending chapter" && reverted.chapter.body === "something rude" && reverted.chapter.edited_by === "admin", "revert put the original text back");

// ---- permanent delete requires removal first ----
const target = () => page.locator("article.card", { hasText: "Offending chapter" });
ok((await target().getByRole("button", { name: "Delete permanently" }).count()) === 0, "no permanent delete on a live chapter");
await target().getByRole("button", { name: "Remove" }).click();
await page.getByText(/Removed, hiding/).waitFor();
await page.goto(`${BASE}/admin?removed=1&story=${s.story_id}`);
await target().getByRole("button", { name: "Delete permanently" }).click();
await page.getByText(/Deleted 2 chapters/).waitFor();
ok(true, "permanent delete removes the chapter and the one below it");
ok((await page.locator("article.card", { hasText: "Innocent child" }).count()) === 0, "…and they leave the list");

// ---- session ends ----
await page.getByRole("button", { name: "Sign out" }).click();
await page.getByLabel("Admin password").waitFor();
ok(true, "signing out returns to the login form");
const anon = await fetch(`${BASE}/api/admin/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", kind: "chapter", id: "x" }) });
ok(anon.status === 401, "and the API refuses without a session");

await browser.close();
process.exit(failed ? 1 : 0);
