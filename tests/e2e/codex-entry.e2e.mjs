import { launch, useMockAi } from "./browser.mjs";
import { entryAction, factRow, openTab } from "./entryPage.mjs";

// The codex entry's own page: the bar (back, name, chapter picker, ‹ ›, ⋯), the details line and Edit details, the form
// row and Change form, the icon (picked from a saved picture or uploaded, shown in the codex list), the line to the changes waiting
// beside the text, and the places that lead to the page (the codex list, the Story Bible, the ☰ menu, the writing
// page's drawer).
const BASE = process.env.BASE_URL ?? "http://localhost:3111";

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const send = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
};
const post = (url, body) => send("POST", url, body);

const ai = await useMockAi(BASE); // no automatic codex check; nothing here calls the AI
const browser = await launch();
try {
  // ---- a story with one entry: keywords, notes, two forms, facts; Root -> A -> A2 ----
  const story = await post("/api/stories", { title: "Entry Tale", premise: "p", chapter: { title: "Root", body: "Rowan stood there.", choices: ["Go to A"] } });
  const sid = story.story_id;
  const R = story.chapter_id;
  const choice = (await send("GET", `/api/chapters/${R}`)).choices[0];
  const A = (await post("/api/chapters", { choice_id: choice.id, title: "Chapter A", body: "Rowan's ears changed. Her hair turned silver.", choices: ["Onward"] })).chapter_id;
  const A2 = (await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${A}`)).choices[0].id, title: "Chapter A2", body: "Rowan rested.", choices: ["Further"] })).chapter_id;
  const rowan = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Rowan", type: "character", aliases: ["Ro", "the traveller"], content: "She is shy and quick.", always_include: false })).entry_id;
  const fact = (anchor_chapter_id, aspect, text, form = "") => post("/api/codex/facts", { anchor_chapter_id, entry_id: rowan, op: "set", aspect, form, text });
  await fact(R, "Ears", "round human ears");
  await fact(R, "Tail", "no tail at all", "human");
  await fact(R, "Tail", "a bushy russet tail", "vixen");
  await fact(R, "form", "", "human");
  await fact(A2, "form", "", "human"); // a later chapter sets the form again
  const entryUrl = (at) => `${BASE}/s/${sid}/codex/${rowan}?at=${at}`;

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  page.on("dialog", (d) => d.accept());
  const ed = page.locator(".entry-editor");
  const bar = page.locator(".entry-bar");
  const box = async (loc) => (await loc.first().boundingBox());
  const entryAt = async (chapter) => (await send("GET", `/api/chapters/${chapter}/codex`)).entries.find((e) => e.name === "Rowan");

  // ---- the list opens the entry's page ----
  await page.goto(`${BASE}/c/${A}/codex`);
  const card = page.locator(".entry-card", { hasText: "Rowan" });
  await card.waitFor();
  const cardText = await card.innerText();
  ok(cardText.includes("Keywords: Ro, the traveller") && cardText.includes("Form: human") && cardText.includes("round human ears"), "the list card shows keywords, form and what the AI reads");
  ok(!cardText.includes("She is shy"), "…and not the notes");
  await card.click();
  await page.getByRole("heading", { name: "Rowan", level: 1 }).waitFor();
  ok(page.url() === entryUrl(A), "the card opens the entry page at this chapter: " + page.url());

  // ---- the bar: back to the codex, the name, ‹ the chapter ›, ⋯ ----
  ok((await bar.getByRole("link", { name: "← Codex" }).getAttribute("href")) === `/s/${sid}/review?tab=codex&chapter=${A}`, "the bar leads back to the codex at the chapter");
  ok((await bar.getByRole("heading", { level: 1 }).innerText()) === "Rowan" && (await bar.locator(".entry-chapter-picker > summary").innerText()).trim() === "“Chapter A” ▾", "…names the entry and the chapter it is shown as of");
  ok((await bar.getByRole("link", { name: "Previous chapter: “Root”" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${R}`, "‹ goes to the entry at the chapter before");
  ok((await bar.getByRole("link", { name: "Next chapter: “Chapter A2”" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${A2}`, "› goes to the entry at the chapter after");
  await bar.locator(".entry-chapter-picker > summary").click();
  const list = bar.locator(".entry-chapter-list");
  ok((await list.getByRole("link", { name: "Root" }).getAttribute("href")) === `/s/${sid}/codex/${rowan}?at=${R}` && (await list.locator("strong[aria-current]").innerText()) === "Chapter A" && (await list.getByRole("link", { name: "Chapter A2" }).count()) === 1, "the chapter button lists the chapters on the path, this one, and the ones after it");
  await list.getByRole("link", { name: "Root" }).click();
  await page.waitForURL(entryUrl(R));
  ok((await bar.getByRole("link", { name: /^Previous chapter/ }).count()) === 0, "a chapter picked there opens the entry at it; the entry's first chapter has no ‹");
  await page.goto(entryUrl(A));
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(200);
  ok((await box(bar)).y >= 0 && (await box(bar)).y < 120, "the bar stays at the top while the page scrolls");
  await page.mouse.wheel(0, -4000);

  // ---- the details line, and Edit details opening the form ----
  const details = ed.locator(".entry-details-text");
  const detailsText = (await details.innerText()).replace(/\s+/g, " ");
  ok(detailsText.includes("Character") && detailsText.includes("First appears in Ch. 1 “Root”") && detailsText.includes("Keywords: Ro, the traveller"), "the details line has the type, where it first appears and the keywords: " + detailsText);
  ok((await ed.locator("form.entry-details-form").count()) === 0, "the details form is closed at first");
  await details.getByRole("button", { name: "Edit details" }).click();
  const dForm = ed.locator("#entry-details form.entry-details-form");
  ok((await ed.locator(".entry-keywords").innerText()).replace(/\s+/g, " ") === "Inherited: Ro (from “Root”), the traveller (from “Root”)", "Edit details opens the form, with the keywords from an earlier chapter listed with where from");
  ok((await dForm.getByLabel(/Keywords/).inputValue()) === "Ro, the traveller" && (await dForm.getByRole("button", { name: "This chapter", exact: true }).getAttribute("aria-pressed")) === "true", "…the keywords in their box, taking effect from this chapter");
  await page.setViewportSize({ width: 1280, height: 800 });
  const labelOf = (text) => dForm.locator("label, .chapter-picker-label", { hasText: new RegExp(`^${text}`) });
  const sameRow = async (text, control) => Math.abs((await box(control)).y - (await box(labelOf(text))).y) < 6 && (await box(control)).x > (await box(labelOf(text))).x + 100;
  ok((await sameRow("Name", dForm.getByLabel("Name"))) && (await sameRow("Keywords", dForm.getByLabel(/Keywords/))), "on a wide screen the fields are on the same row as their labels");
  await dForm.getByLabel(/Keywords/).fill("Ro, the traveller, the fox");
  await dForm.getByRole("button", { name: "Save changes" }).click();
  await dForm.getByText("Saved", { exact: true }).waitFor();
  ok((await entryAt(A)).aliases.join() === "Ro,the traveller,the fox" && (await entryAt(R)).aliases.join() === "Ro,the traveller", "the keywords were saved at this chapter, not earlier");
  await page.reload();
  ok((await ed.locator(".entry-details-text").innerText()).includes("Keywords: Ro, the traveller, the fox"), "…and the details line shows them");

  // ---- the form row: Change form… opens a panel; a later chapter that sets the form is named ----
  const formRow = ed.locator(".ef-form-row");
  ok((await formRow.innerText()).includes("Lasts until “Chapter A2”, where Rowan is human."), "the form row says which later chapter sets the form again");
  await formRow.getByRole("button", { name: "Change form…" }).click();
  const options = (await formRow.getByLabel("Form", { exact: true }).locator("option").allInnerTexts()).map((t) => t.trim());
  ok(options.slice(0, -1).sort().join("|") === "human|vixen" && options.at(-1) === "+ a new form…", "the panel offers the entry's forms and a new one: " + options.join("|"));
  const from = (await formRow.getByLabel("From").locator("option").allInnerTexts()).map((t) => t.trim());
  ok(from.join("|") === "“Chapter A” (this chapter)|“Chapter A2”", "…from this chapter or a later one: " + from.join("|"));
  await formRow.getByLabel("Form", { exact: true }).selectOption("vixen");
  await formRow.getByLabel("How far along (optional)").fill("halfway");
  ok(await formRow.getByText("The AI will read: Form: vixen, halfway.").isVisible() && (await formRow.getByText("Rowan's vixen facts replace the every-form ones on the same aspect while Rowan is in that form.").isVisible()), "a live line shows what the AI will read, and that the form's facts replace the every-form ones");
  const formPost = page.waitForRequest((r) => r.url().endsWith("/api/codex/form"));
  await formRow.getByRole("button", { name: "Save", exact: true }).click();
  const body = JSON.parse((await formPost).postData());
  ok(body.move.length === 0 && body.form.anchor_chapter_id === A && body.form.name === "vixen", "Save changes the form from the chosen chapter and moves no facts");
  await formRow.locator(".facts-form", { hasText: "halfway" }).waitFor();
  ok((await formRow.innerText()).includes("vixen — halfway") && (await formRow.innerText()).includes("normal form: human"), "the form, its stage and the normal form show");
  ok((await ed.locator(".entry-ai-told .fact-ai").innerText()).includes("Form: vixen, halfway."), "What the AI is told has the form line");
  ok(await ed.getByRole("heading", { name: "vixen only · the form now" }).isVisible() && (await ed.locator(".ef-other summary", { hasText: "human only" }).isVisible()), "the facts are grouped by form, the current one shown, the other folded");

  // ---- no notes: text kept in an entry's old notes shows nowhere ----
  ok(!(await ed.innerText()).includes("She is shy") && (await page.getByRole("tab", { name: "Your notes" }).count()) === 0, "an entry has no notes: no Your notes tab, and old notes don't show");
  ok((await page.getByRole("button", { name: "Turn notes into facts" }).count()) === 0, "…and no Turn notes into facts");
  ok((await fetch(`${BASE}/api/stories/${sid}/notes-to-facts`, { method: "POST" })).status === 404, "…nor its route");

  // ---- the icon: none yet; picked from a saved picture, or uploaded; shown round on the page and in the codex list ----
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await fetch(`${BASE}/api/chapters/${A}/images/header`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  await page.reload();
  await ed.locator(".fact-ai").first().waitFor();
  const iconButton = page.getByRole("button", { name: "Add an icon for Rowan" });
  ok(await iconButton.isVisible(), "with no icon the details line offers to add one");
  await iconButton.click();
  const iconPanel = page.getByRole("region", { name: "Icon" });
  const savedList = iconPanel.getByRole("list", { name: "The story's saved pictures" });
  await savedList.waitFor();
  ok((await savedList.getByRole("button").allInnerTexts()).some((t) => t.includes("Chapter A header")), "the story's saved pictures are offered: " + (await savedList.getByRole("button").allInnerTexts()).join("|"));
  const putIcon = page.waitForResponse((r) => r.url().includes(`/codex-icons/${rowan}`) && r.request().method() === "PUT");
  await savedList.getByRole("button", { name: /Chapter A header/ }).click();
  ok((await putIcon).ok(), "picking a saved picture saves it as the icon");
  await page.getByRole("button", { name: "Change the icon of Rowan" }).locator("img.codex-icon").waitFor();
  const icons = (await send("GET", `/api/stories/${sid}/codex-icons`)).icons;
  ok(typeof icons[rowan] === "number", "the story's icon list has it");
  const iconRes = await fetch(`${BASE}/api/stories/${sid}/codex-icons/${rowan}?v=${icons[rowan]}`);
  ok(iconRes.ok && iconRes.headers.get("content-type") === "image/jpeg", "the icon is kept as a square JPEG");
  // An upload replaces it.
  const putUpload = page.waitForResponse((r) => r.url().includes(`/codex-icons/${rowan}`) && r.request().method() === "PUT");
  await iconPanel.getByLabel("Icon file").setInputFiles({ name: "rowan.png", mimeType: "image/png", buffer: png });
  ok((await putUpload).ok(), "an uploaded file becomes the icon");
  await iconPanel.getByText("Icon saved.").waitFor();
  ok((await send("GET", `/api/stories/${sid}/codex-icons`)).icons[rowan] > icons[rowan], "…with a new version");
  // The codex list in the Story Bible shows it round beside the name.
  await page.goto(`${BASE}/s/${sid}/review?tab=codex&chapter=${A}`);
  const rowanCard = page.locator(".entry-card", { hasText: "Rowan" });
  await rowanCard.waitFor();
  ok(await rowanCard.locator("img.codex-icon").isVisible(), "the codex list shows the icon on the entry's card");
  ok(await rowanCard.locator("img.codex-icon").evaluate((el) => getComputedStyle(el).borderRadius === "50%"), "…round");
  await page.goto(entryUrl(A));
  await page.getByRole("button", { name: "Change the icon of Rowan" }).click();
  await page.getByRole("region", { name: "Icon" }).getByRole("button", { name: "Remove the icon" }).click();
  await page.getByRole("button", { name: "Add an icon for Rowan" }).waitFor();
  ok(!((await send("GET", `/api/stories/${sid}/codex-icons`)).icons[rowan]), "Remove the icon takes it away");
  await page.goto(entryUrl(A));
  await ed.locator(".fact-ai").first().waitFor();

  // ---- a suggestion from the text: the line to the review beside the text, and a marker on the fact ----
  ok((await ed.locator(".entry-waiting").count()) === 0, "with nothing waiting there is no changes line");
  await fact(R, "Hair", "dark hair");
  const rev = (await send("GET", `/api/chapters/${A}`)).chapter.revision;
  await post(`/api/chapters/${A}/codex-suggestions`, { revision: rev, suggestions: [{ kind: "set", entry_id: rowan, aspect: "Hair", form: "", after: "silver", quote: "Her hair turned silver." }] });
  const sug = (await send("GET", `/api/stories/${sid}/codex-suggestions?status=open`)).suggestions.find((s) => s.after === "silver");
  await page.goto(entryUrl(A));
  const waiting = ed.locator(".entry-waiting");
  await waiting.waitFor();
  ok((await waiting.getByRole("link").first().innerText()).includes("1 change waiting from “Chapter A” · Review beside the text →") && (await waiting.getByRole("link").first().getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}`, "one line says a change waits and links to the review beside the chapter's text");
  const marker = factRow(page, "dark hair").locator(".ef-marker-suggest");
  ok((await marker.innerText()).includes("“Chapter A” suggests “silver” · Review") && (await marker.getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}#s-${sug.id}`, "the fact has a marker linking to the suggestion's card");
  ok((await ed.locator("article.inbox-card").count()) === 0 && (await ed.getByRole("button", { name: "Accept" }).count()) === 0, "there are no suggestion cards to accept here");
  await page.goto(entryUrl(A2));
  await waiting.waitFor();
  ok((await waiting.innerText()).includes("Changes waiting from earlier chapters") && (await waiting.getByRole("link", { name: "“Chapter A” (1)" }).getAttribute("href")) === `/c/${A}/codex-review?entry=${rowan}`, "a later chapter links to the earlier chapter's review");

  // ---- a missing or foreign ?at= opens the chapter where the entry was last changed ----
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}`);
  ok(page.url().endsWith(`/codex/${rowan}`) && (await bar.locator(".entry-chapter-picker > summary").innerText()).includes("“Chapter A”"), "without ?at= the entry opens where it was last changed");
  await page.goto(`${BASE}/s/${sid}/codex/${rowan}?at=nonsense`);
  ok(await page.getByRole("heading", { name: "Rowan", level: 1 }).isVisible(), "a chapter that isn't in the story is ignored");

  // ---- the Story Bible lists the entry and links to its page, not the pictures page ----
  await page.goto(`${BASE}/s/${sid}/review?tab=codex`);
  const bibleLink = page.locator(".entry-cards a", { hasText: "Rowan" });
  const href = await bibleLink.getAttribute("href");
  ok(/^\/s\/[^/]+\/codex\/[^/]+\?at=/.test(href) && !href.includes("/pictures"), "the Story Bible's entry list links to the entry page: " + href);
  await bibleLink.click();
  await page.getByRole("heading", { name: "Rowan", level: 1 }).waitFor();

  // ---- the ☰ menu leads to the Story Bible from a chapter page and a story page ----
  await page.goto(`${BASE}/c/${A}`);
  await page.locator(".site-menu > summary").click();
  await page.locator(".site-menu").getByRole("link", { name: "Story Bible", exact: true }).click();
  await page.waitForURL(new RegExp(`/s/${sid}/review\\?chapter=${A}`));
  ok(await page.getByRole("heading", { name: "Story Bible", level: 1 }).isVisible(), "the ☰ menu's Story Bible link lands on the Story Bible");
  await page.goto(`${BASE}/c/${A2}/write?choice=${(await send("GET", `/api/chapters/${A2}`)).choices[0].id}`);

  // ---- the writing page's drawer opens the entry inside the drawer ----
  await page.locator(".site-menu > summary").click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  const drawer = page.locator("aside.codex-drawer");
  await drawer.waitFor();
  await drawer.locator(".entry-card", { hasText: "Rowan" }).click();
  await drawer.getByRole("heading", { name: "Rowan" }).waitFor();
  ok(page.url().includes("/write") && (await drawer.getByLabel(/Keywords/).count()) === 1, "tapping a card opens the entry in the drawer, without leaving the page");
  await drawer.getByRole("button", { name: "← All entries" }).click();
  await drawer.locator(".entry-card", { hasText: "Rowan" }).waitFor();
  ok(true, "← All entries goes back to the list");

  // ---- branches: the chapters after, the summary, inherited keywords, removing from one chapter ----
  const hub = await post("/api/stories", { title: "Hub Tale", premise: "p", chapter: { title: "Hub", body: "A crossroads.", summary: "The travellers meet at the hub.", choices: ["Go down", "Climb up"] } });
  const H = hub.chapter_id;
  const [downChoice, upChoice] = (await send("GET", `/api/chapters/${H}`)).choices;
  const cellar = (await post("/api/chapters", { choice_id: downChoice.id, title: "The cellar", body: "Damp.", choices: [] })).chapter_id;
  const roof = (await post("/api/chapters", { choice_id: upChoice.id, title: "The roof", body: "Windy.", choices: ["Climb higher"] })).chapter_id;
  await post("/api/chapters", { choice_id: (await send("GET", `/api/chapters/${roof}`)).choices[0].id, title: "The chimney", body: "Soot.", choices: [] });
  const lampFields = { name: "Lamp", type: "item", aliases: ["lantern"], content: "", always_include: false };
  const lamp = (await post("/api/codex", { anchor_chapter_id: H, op: "create", ...lampFields })).entry_id;
  await post("/api/codex", { anchor_chapter_id: cellar, op: "replace", entry_id: lamp, ...lampFields, content: "Cracked in the cellar." });
  await post("/api/codex", { anchor_chapter_id: H, op: "replace", entry_id: lamp, ...lampFields, aliases: ["lantern", "lamp"] }); // added after the child changed
  const lampUrl = (at) => `${BASE}/s/${hub.story_id}/codex/${lamp}?at=${at}`;

  await page.goto(lampUrl(H));
  await page.getByRole("heading", { name: "Lamp", level: 1 }).waitFor();
  await bar.locator(".entry-chapter-picker > summary").click();
  const later = (await bar.locator(".entry-chapter-list ul li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(later.join("|") === "The cellar|The roof …", "the chapter button lists the chapters that come next, with … after one that has chapters after it: " + later.join("|"));
  await bar.locator(".entry-chapter-picker > summary").click();
  await entryAction(page, "Summary of this chapter");
  ok(await ed.locator("#entry-summary").getByText("The travellers meet at the hub.").isVisible(), "Summary of this chapter in the ⋯ menu shows the chapter's summary");
  await page.goto(lampUrl(cellar));
  await entryAction(page, "Summary of this chapter");
  ok((await ed.locator("#entry-summary").innerText()).includes("No summary yet.") && (await ed.locator("#entry-summary a").getAttribute("href")) === `/c/${cellar}`, "a chapter without a summary says so and links to the chapter");
  await ed.locator(".entry-details-text").getByRole("button", { name: "Edit details" }).click();
  const kwText = (await ed.locator(".entry-keywords").innerText()).replace(/\s+/g, " ");
  ok(kwText === "Inherited: lantern (from “Hub”), lamp (from “Hub”)", "inherited keywords say which chapter they came from: " + kwText);

  // Remove from this chapter only
  const menuItem = (name) => bar.locator(".more-menu-items").getByRole("button", { name });
  await bar.getByLabel("More entry actions", { exact: true }).click();
  const removeItem = menuItem("Remove from this chapter only…");
  ok((await removeItem.isDisabled()) && ((await removeItem.getAttribute("title")) ?? "").includes("nothing to keep it in"), "with no chapter after it, “Remove from this chapter only…” is disabled and says why");
  await page.goto(lampUrl(H));
  await bar.getByLabel("More entry actions", { exact: true }).click();
  ok(((await removeItem.getAttribute("title")) ?? "").includes("Lamp stays in the 2 chapters after “Hub”."), "…and otherwise says how many chapters keep the entry");
  await removeItem.click();
  await page.waitForURL(lampUrl(cellar));
  ok(!(await send("GET", `/api/chapters/${H}/codex`)).entries.some((e) => e.name === "Lamp"), "it goes to the first chapter that keeps it, and the entry is gone at that chapter…");
  ok((await send("GET", `/api/chapters/${roof}/codex`)).entries.find((e) => e.name === "Lamp")?.aliases.join() === "lantern,lamp", "…and still there in the other chapter after it, with its keywords");

  // ---- the ⋯ menu, the tabs and the layout on a phone ----
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  phone.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
  await phone.goto(entryUrl(A));
  await phone.getByRole("heading", { name: "Rowan", level: 1 }).waitFor();
  const pbar = phone.locator(".entry-bar");
  ok((await box(pbar.locator(".entry-bar-at"))).y > (await box(pbar.getByRole("heading", { level: 1 }))).y + 10, "on a phone the chapter goes under the name");
  await pbar.getByLabel("More entry actions", { exact: true }).click();
  const items = (await pbar.locator(".more-menu-items > *").allInnerTexts()).map((t) => t.trim());
  ok(items.join("|") === "Edit details|Change the icon…|Compare with a chapter…|Summary of this chapter|Share to other stories…|Remove from this chapter only…|Retire from here on…", "the ⋯ menu lists the entry's actions: " + items.join("|"));
  const menuBox = await box(pbar.locator(".more-menu-items"));
  ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, "the menu stays on the phone screen");
  await pbar.locator(".more-menu-items").getByRole("button", { name: "Change the icon…" }).click();
  ok(await phone.getByRole("region", { name: "Icon" }).isVisible(), "Change the icon… opens the icon picker");
  await pbar.getByLabel("More entry actions", { exact: true }).click();
  await pbar.locator(".more-menu-items").getByRole("button", { name: "Compare with a chapter…" }).click();
  ok(await phone.locator("#entry-compare-panel").getByText("Compare with").isVisible(), "Compare with a chapter… opens the comparison picker");
  const tabs = (await phone.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  ok(tabs.join("|") === "What the AI reads|History|Update from the story", "the tabs: " + tabs.join("|"));
  await openTab(phone, "Update from the story");
  ok(await phone.getByRole("tabpanel").locator(".update-from-story").isVisible(), "the Update from the story tab shows the update");
  ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the entry page does not scroll sideways at 390px");
  await phone.context().close();
} catch (e) {
  console.log("ERROR", e.message);
  failed = true;
} finally {
  await send("PUT", "/api/queue/paused", { paused: false }).catch(() => {});
  await browser.close();
  await ai.restore();
}
process.exit(failed ? 1 : 0);
