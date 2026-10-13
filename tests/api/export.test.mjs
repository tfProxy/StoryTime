// Story exports (Markdown, Twee, JSON), the outline page, and the health endpoint.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const get = async (url) => { const r = await fetch(B + url); return { status: r.status, text: await r.text(), headers: r.headers }; };

ok((await call("GET", "/api/health")).json?.ok === true, "health endpoint reports ok");

// root -> [Left -> [Deep], Right (unwritten), Gone (will be removed)]
const KEY = "export-key-0123456789abcdef";
let r = await call("POST", "/api/stories", { title: "The Export: Tale!", premise: "A premise.\nSecond line.", author_name: "Eve", chapter: { title: "Start", body: "It began.\n\n:: not a passage", author_name: "Eve", edit_key: KEY, choices: ["Go left", "Go [[right]]", "Gone"] } });
const story = r.json.story_id, root = r.json.chapter_id;
let choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const fill = async (c, title, extra = {}) => (await call("POST", "/api/chapters", { choice_id: c.id, title, body: `${title} text`, author_name: "Bo", ...extra })).json.chapter_id;
const left = await fill(choices[0], "Left", { choices: ["Deeper"] });
const gone = await fill(choices[2], "Gone chapter");
const deep = await fill((await call("GET", `/api/chapters/${left}`)).json.choices[0], "Deep");
await call("POST", "/api/codex", { anchor_chapter_id: left, op: "create", name: "Mira", content: "A thief.", aliases: ["the thief"], always_include: true });

// Mark one chapter removed through the CLI-compatible admin API.
const login = await fetch(B + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
await fetch(B + "/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ action: "remove", kind: "chapter", id: gone }) });

// ---- Markdown ----
let x = await get(`/api/stories/${story}/export?format=md`);
ok(x.status === 200 && /text\/markdown/.test(x.headers.get("content-type")) && /attachment; filename="the-export-tale\.md"/.test(x.headers.get("content-disposition")), "markdown download has a safe filename");
ok(x.text.startsWith("# The Export: Tale!") && x.text.includes("> A premise.\n> Second line.") && x.text.includes("*by Eve*"), "title, premise and author");
ok(x.text.includes("## 1. Start") && x.text.includes("## 1.1. Left") && x.text.includes("## 1.1.1. Deep"), "chapters are numbered by position in the tree");
ok(x.text.includes("- **Go left** → chapter 1.1") && x.text.includes("- **Go [[right]]** → *(not written yet)*"), "choices point at their chapters, unwritten ones are marked");
ok(!x.text.includes("Gone chapter"), "a removed chapter is left out");
ok(x.text.includes("- **Gone** → *(not written yet)*"), "a removed chapter's choice shows as unwritten");
ok(x.text.includes("*The end of this branch.*"), "dead ends are marked");

// ---- Twee ----
x = await get(`/api/stories/${story}/export?format=twee`);
ok(x.status === 200 && /filename="the-export-tale\.twee"/.test(x.headers.get("content-disposition")), "twee download");
ok(x.text.includes(":: StoryTitle\nThe Export: Tale!") && x.text.includes(":: StoryData") && /"ifid": "[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-A[0-9A-F]{3}-[0-9A-F]{12}"/.test(x.text) && x.text.includes('"start": "Start"'), "story header, IFID and start passage");
ok(x.text.includes(":: Start\n") && x.text.includes("[[Go left->Left]]") && x.text.includes(":: Left\n") && x.text.includes("[[Deeper->Deep]]"), "passages and links");
ok(!x.text.includes("[[right]]") && x.text.includes("(not written yet) Go [ [right] ]"), "link syntax in unwritten choices is neutralised");
ok(!/^:: not a passage/m.test(x.text) && x.text.includes(": : not a passage"), "text can't start a bogus passage");
ok((x.text.match(/^:: /gm) ?? []).length === 5, "exactly the right number of passages (title, data, 3 chapters)");

// ---- JSON ----
x = await get(`/api/stories/${story}/export?format=json`);
const data = JSON.parse(x.text);
ok(data.format === "storytime-export" && data.version === 1 && data.story.title === "The Export: Tale!", "json header");
ok(data.chapters.length === 3 && data.chapters.map((c) => c.title).join() === "Start,Left,Deep", "json chapters in reading order, without removed ones");
ok(data.choices.length === 4 && data.codex.length === 1 && data.codex[0].aliases[0] === "the thief" && data.codex[0].always_include === true, "json choices and codex");
ok(!x.text.includes("edit_key") && !x.text.includes(KEY), "no edit keys or hashes in exports");

// ---- errors ----
ok((await get(`/api/stories/${story}/export?format=pdf`)).status === 400, "unknown format 400");
ok((await get(`/api/stories/nope/export`)).status === 404, "unknown story 404");

// ---- outline page ----
x = await get(`/s/${story}/outline`);
const html = x.text.replace(/<!-- -->/g, "");
ok(x.status === 200 && html.includes("Start") && html.includes("Left") && html.includes("Deep"), "outline lists the chapters");
ok(html.includes("not written yet") && html.includes("branch ends here"), "outline marks unwritten choices and dead ends");
ok(!html.includes("Gone chapter"), "outline leaves out removed chapters");
ok(/3 chapters/.test(html) && /2 choices still to write/.test(html), "outline totals: " + (/(\d+ chapters[^<]*)/.exec(html)?.[1] ?? "?"));
ok((await get(`/s/nope/outline`)).status === 404, "outline of an unknown story 404");
ok((await get(`/s/${story}`)).text.includes("export?format=twee"), "story page links to the downloads");
