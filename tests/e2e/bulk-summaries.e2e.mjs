// "Redo summaries" for a whole story: chapters this browser posted are rewritten, others' are only
// filled in when missing, and each chapter builds on its parent's new story-so-far.
import http from "node:http";
import { launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const calls = [];
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const user = body.messages.at(-1).content;
    calls.push(user);
    const title = /Chapter: "([^"]*)"/.exec(user)?.[1];
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ summary: `SUM(${title})`, story_so_far: `SOFAR(${title})` }) } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(3222, r));

let failed = false;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const post = async (url, body) => (await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const chapter = async (id) => (await (await fetch(`${BASE}/api/chapters/${id}`)).json());

// A (mine) -> B (someone else's, complete) -> C (mine) -> D (someone else's, no summaries)
const KEY_A = "a".repeat(24), KEY_C = "c".repeat(24);
const old = (n) => ({ summary: `OLD ${n}`, path_summary: `OLDPATH ${n}` });
const s = await post("/api/stories", { title: "Bulk story", chapter: { title: "A", body: "a text", choices: ["to b"], edit_key: KEY_A, ...old("A") } });
const A = s.chapter_id;
const next = async (parent, title, extra) => {
  const choice = (await chapter(parent)).choices[0];
  const r = await post("/api/chapters", { choice_id: choice.id, title, body: `${title} text`, choices: title === "D" ? [] : ["on"], ...extra });
  return r.chapter_id;
};
const B = await next(A, "B", old("B"));
const C = await next(B, "C", { edit_key: KEY_C, ...old("C") });
const D = await next(C, "D", {});

const browser = await launch();
const ctx = await browser.newContext();
await ctx.addInitScript(([a, c, ka, kc]) => {
  localStorage.setItem("storytime.settings.v1", JSON.stringify({ authorName: "Ann", activeProvider: "ollama",
    providers: { ollama: { baseUrl: "http://localhost:3222/v1", apiKey: "", model: "main", summaryModel: "cheap" } } }));
  localStorage.setItem("storytime.editKeys.v1", JSON.stringify({ [a]: ka, [c]: kc }));
}, [A, C, KEY_A, KEY_C]);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/s/${s.story_id}/outline`);
await page.locator(".site-menu > summary").click();
await page.getByRole("link", { name: "Redo the AI summaries" }).click();
await page.waitForURL(/\/summaries$/);
await page.getByText(/This browser posted 2 of them/).waitFor();
ok(await page.getByText(/only a missing summary can be filled in \(1 is missing one\)/).isVisible(), "it explains what it can and can't change");

await page.getByRole("button", { name: "Redo summaries" }).click();
await page.getByText("2 rewritten, 1 filled in, 1 left as they were.").waitFor({ timeout: 20000 });
ok(calls.length === 3, "one request for each chapter it changes: " + calls.length);
ok(calls[0].includes("first chapter") && calls[1].includes("Summary of the story before this chapter:\nOLDPATH B") && calls[2].includes("Summary of the story before this chapter:\nSOFAR(C)"), "each chapter builds on its parent's current story-so-far");
const got = async (id) => (await chapter(id)).chapter;
ok((await got(A)).summary === "SUM(A)" && (await got(A)).path_summary === "SOFAR(A)", "a chapter I posted is rewritten");
ok((await got(B)).summary === "OLD B" && (await got(B)).path_summary === "OLDPATH B", "someone else's complete summary is left alone");
ok((await got(C)).summary === "SUM(C)" && (await got(C)).path_summary === "SOFAR(C)", "my chapter below it is rewritten too");
ok((await got(D)).summary === "SUM(D)" && (await got(D)).path_summary === "SOFAR(D)", "someone else's missing summary is filled in");

// a browser with no keys can only fill gaps, and there are none left
const other = await (await browser.newContext()).newPage();
await other.goto(`${BASE}/s/${s.story_id}/summaries`);
await other.getByText(/didn't post any of them/).waitFor();
ok(await other.getByRole("button", { name: "Redo summaries" }).isDisabled(), "with nothing to change the button is off");

await browser.close(); mock.close();
process.exit(failed ? 1 : 0);
