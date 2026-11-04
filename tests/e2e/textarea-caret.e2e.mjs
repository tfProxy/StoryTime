// On a phone, typing in a long, self-growing text box keeps the cursor on screen: the page does not
// jump while the box measures itself, and typing after scrolling away brings the cursor back.
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const json = async (method, url, body) =>
  (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

const story = await json("POST", "/api/stories", { title: "Caret", premise: "p", chapter: { title: "Root", body: "Start.", choices: ["On", "Off"] } });
const [on] = (await json("GET", `/api/chapters/${story.chapter_id}`)).choices;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());
await page.goto(`${BASE}/c/${story.chapter_id}/write?choice=${on.id}`);

const body = page.getByLabel("Chapter text");
const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: the rain kept falling on the old stone road.`).join("\n\n");
await body.fill(long);

// Where the cursor is on screen, measured with a copy of the text (as the app does).
const caretOnScreen = () => page.evaluate(() => {
  const el = document.getElementById("chapter-body");
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const m = document.createElement("div");
  for (const p of ["boxSizing", "width", "padding", "border", "font", "lineHeight", "letterSpacing"]) m.style[p] = s[p];
  Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  m.textContent = el.value.slice(0, el.selectionEnd);
  const mark = m.appendChild(document.createElement("span"));
  mark.textContent = "​";
  document.body.appendChild(m);
  const top = r.top + mark.offsetTop;
  m.remove();
  return { top, height: window.innerHeight };
});

// Cursor in the middle, shown on screen; typing must not move the page.
await body.evaluate((el) => {
  el.focus();
  const at = el.value.indexOf("Paragraph 40:");
  el.setSelectionRange(at, at);
});
await page.waitForTimeout(400);
const mid = await caretOnScreen();
await page.evaluate((dy) => window.scrollBy(0, dy), mid.top - 300);
await page.waitForTimeout(200);
const yBefore = await page.evaluate(() => window.scrollY);
await page.keyboard.type("x");
await page.waitForTimeout(200);
const yAfter = await page.evaluate(() => window.scrollY);
ok(Math.abs(yAfter - yBefore) < 2, `typing with the cursor in view does not move the page (${yBefore} → ${yAfter})`);

// Cursor at the end, then the page scrolled back to the top; typing brings the cursor into view.
await body.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
let c = await caretOnScreen();
ok(c.top > c.height, "the cursor is off screen after scrolling away");
await page.keyboard.type("y");
await page.waitForTimeout(300);
c = await caretOnScreen();
ok(c.top > 0 && c.top < c.height, `typing brings the cursor back on screen (at ${Math.round(c.top)} of ${c.height})`);

await browser.close();
await fetch(`${BASE}/api/drafts/${encodeURIComponent(`fill:${on.id}`)}`, { method: "DELETE" });
await fetch(`${BASE}/api/stories/${story.story_id ?? story.id}`, { method: "DELETE" }).catch(() => {});
process.exit(failed ? 1 : 0);
