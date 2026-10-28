// The prompt history (/ai-log): a recorded call shows in the list; the filters (source, Failed only, a URL ?source=)
// work; opening a call shows System, Message and Reply with Copy buttons, and Copy all puts one block of text on the
// clipboard; the menu links to it; a call the browser makes (Settings > Try a sample reply) is recorded as "browser".
// It asserts on its own rows (the log is shared with other tests and has no delete route).
import { launch, useMockAi } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const until = async (fn, what, tries = 100) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  ok(false, `timed out waiting for ${what}`);
  return false;
};
const list = async (q = "") => (await (await fetch(`${BASE}/api/ai-log?${q}`)).json()).calls;
const post = async (body) => (await fetch(`${BASE}/api/ai-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

const GOOD = "E2E history good";
const BAD = "E2E history bad";
const now = Date.now();
const base = { ms: 1500, connection: "Test", model: "e2e-model", role: "main", temperature: 0.7, thinkingOff: false };
const goodId = (await post({ ...base, at: now, source: GOOD, system: "SYSTEMTEXT-e2e", messages: [{ role: "user", content: "MESSAGETEXT-e2e" }], reply: "REPLYTEXT-e2e", status: "ok" })).id;
const badId = (await post({ ...base, at: now - 1000, source: BAD, system: "bad system", messages: [{ role: "user", content: "bad message" }], reply: "", status: "failed", error: "The model fell over" })).id;
ok(!!goodId && !!badId, "two calls were stored through POST /api/ai-log");

const mock = await useMockAi(BASE);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 1200 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
const row = (source) => page.locator(`.ai-log-row[data-source="${source}"]`);

try {
  // ---- the menu link ----
  await page.goto(BASE);
  await page.locator(".site-menu summary").click();
  await page.locator(".site-menu-items").getByRole("link", { name: "Prompt history" }).click();
  await page.waitForURL(`${BASE}/ai-log`);
  await page.getByRole("heading", { name: "Prompt history" }).waitFor();
  ok(true, "the menu has a Prompt history link that opens the page");

  // ---- the list ----
  await row(GOOD).waitFor();
  ok(await row(BAD).isVisible(), "both calls are listed");
  ok((await row(BAD).innerText()).includes("failed") && (await row(BAD).innerText()).includes("The model fell over"), "a failed call says so, with its error");
  const order = await page.locator(".ai-log-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-source")));
  ok(order.indexOf(GOOD) < order.indexOf(BAD), "the newest call comes first");

  // ---- filters ----
  await page.getByLabel("Source").selectOption(GOOD);
  await until(async () => (await row(BAD).count()) === 0, "the source filter");
  ok((await row(GOOD).count()) === 1 && (await row(BAD).count()) === 0, "the source filter keeps only that source");
  await page.getByLabel("Source").selectOption("");
  await row(BAD).waitFor();
  await page.getByLabel("Failed only").check();
  await until(async () => (await row(GOOD).count()) === 0, "Failed only");
  ok((await row(BAD).count()) === 1 && (await page.locator(".ai-log-row[data-status=ok]").count()) === 0, "Failed only shows failed calls only");
  await page.getByLabel("Failed only").uncheck();
  await row(GOOD).waitFor();

  await page.goto(`${BASE}/ai-log?run=nothing-like-this`);
  await page.getByTestId("ai-log-empty").waitFor();
  ok((await page.getByRole("link", { name: "Show all calls" }).count()) === 1, "a link filter (?run=) shows how to clear it");
  await page.goto(`${BASE}/ai-log?source=${encodeURIComponent(BAD)}`);
  await row(BAD).waitFor();
  ok((await row(GOOD).count()) === 0 && (await page.getByLabel("Source").inputValue()) === BAD, "?source= pre-filters the list");

  // ---- opening a call ----
  await page.goto(`${BASE}/ai-log?source=${encodeURIComponent(GOOD)}`);
  await row(GOOD).click();
  await page.getByRole("heading", { name: GOOD, exact: true }).waitFor();
  const box = (title) => page.locator(".ai-log-box", { has: page.getByRole("heading", { name: title, exact: true }) });
  ok((await box("System").innerText()).includes("SYSTEMTEXT-e2e"), "the System box shows the system prompt");
  ok((await box("Message").innerText()).includes("MESSAGETEXT-e2e"), "the Message box shows the message");
  ok((await box("Reply").innerText()).includes("REPLYTEXT-e2e"), "the Reply box shows the reply");
  ok((await page.getByText("e2e-model").count()) > 0, "the model is shown");
  await box("Reply").getByRole("button", { name: "Copy" }).click();
  ok((await page.evaluate(() => navigator.clipboard.readText())) === "REPLYTEXT-e2e", "a box's Copy puts its text on the clipboard");
  await page.getByRole("button", { name: "Copy all" }).click();
  const all = await page.evaluate(() => navigator.clipboard.readText());
  ok(
    all.includes(`Source: ${GOOD}`) && all.includes("Model: e2e-model") &&
      all.indexOf("## System\n\nSYSTEMTEXT-e2e") > 0 && all.indexOf("## Message\n\nMESSAGETEXT-e2e") > all.indexOf("## System") &&
      all.indexOf("## Reply\n\nREPLYTEXT-e2e") > all.indexOf("## Message"),
    "Copy all copies the details, then System, Message and Reply under headings",
  );
  await page.getByRole("button", { name: "← Back to the list" }).click();
  await row(GOOD).waitFor();

  // ---- phone width ----
  await page.setViewportSize({ width: 390, height: 844 });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 390px the list doesn't scroll sideways");
  await row(GOOD).click();
  await box("Reply").waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "at 390px an open call doesn't scroll sideways");

  // ---- a browser-side call is recorded ----
  await page.setViewportSize({ width: 1000, height: 1200 });
  const known = new Set((await list("limit=200")).map((c) => c.id));
  await page.goto(`${BASE}/settings#writing`);
  await page.getByRole("button", { name: "Try a sample reply" }).click();
  const seen = await until(async () => (await list("source=Connection%20test")).some((c) => !known.has(c.id) && c.side === "browser"), "the browser call to be recorded", 100);
  ok(seen, "a call made in the browser (a sample reply in Settings) is recorded with side browser");
} finally {
  await mock.restore();
  await browser.close();
}
process.exit(failed ? 1 : 0);
