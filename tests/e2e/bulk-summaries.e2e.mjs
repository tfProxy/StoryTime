// "Redo summaries" for a whole story: every chapter is rewritten, and each one builds on its parent's
// new story-so-far.
import http from "node:http";
import { launch, useMockAi } from "./browser.mjs";

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

// A -> B -> C -> D; the last has no summaries yet
const old = (n) => ({ summary: `OLD ${n}`, path_summary: `OLDPATH ${n}` });
const s = await post("/api/stories", { title: "Bulk story", chapter: { title: "A", body: "a text", choices: ["to b"], ...old("A") } });
const A = s.chapter_id;
const next = async (parent, title, extra) => {
  const choice = (await chapter(parent)).choices[0];
  const r = await post("/api/chapters", { choice_id: choice.id, title, body: `${title} text`, choices: title === "D" ? [] : ["on"], ...extra });
  return r.chapter_id;
};
const B = await next(A, "B", old("B"));
const C = await next(B, "C", old("C"));
const D = await next(C, "D", {});

const browser = await launch();
const ctx = await browser.newContext();
const ai = await useMockAi(BASE);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/s/${s.story_id}/outline`);
await page.locator(".site-menu > summary").click();
await page.getByRole("link", { name: "Redo the AI summaries" }).click();
await page.waitForURL(/\/summaries$/);
await page.getByText(/This story has/).waitFor();

await page.getByRole("button", { name: "Redo summaries" }).click();
await page.getByText("4 rewritten.").waitFor({ timeout: 20000 });
ok(calls.length === 4, "one request for each chapter: " + calls.length);
ok(calls[0].includes("first chapter") && calls[1].includes("Summary of the story before this chapter:\nSOFAR(A)") && calls[2].includes("Summary of the story before this chapter:\nSOFAR(B)") && calls[3].includes("Summary of the story before this chapter:\nSOFAR(C)"), "each chapter builds on its parent's current story-so-far");
const got = async (id) => (await chapter(id)).chapter;
ok((await got(A)).summary === "SUM(A)" && (await got(A)).path_summary === "SOFAR(A)", "the first chapter is rewritten");
ok((await got(B)).summary === "SUM(B)" && (await got(B)).path_summary === "SOFAR(B)", "a chapter that already had a summary is rewritten");
ok((await got(C)).summary === "SUM(C)" && (await got(C)).path_summary === "SOFAR(C)", "the next chapter is rewritten too");
ok((await got(D)).summary === "SUM(D)" && (await got(D)).path_summary === "SOFAR(D)", "a chapter with no summary gets one");

await browser.close(); mock.close();
await ai.restore();
process.exit(failed ? 1 : 0);
