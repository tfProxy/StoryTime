// Story exports (Markdown, Twee, JSON), the outline page, and the health endpoint.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const get = async (url) => { const r = await fetch(B + url); return { status: r.status, text: await r.text(), headers: r.headers }; };

ok((await call("GET", "/api/health")).json?.ok === true, "health endpoint reports ok");

// root -> [Left -> [Deep], Right (unwritten), Gone (will be deleted)]
let r = await call("POST", "/api/stories", { title: "The Export: Tale!", premise: "A premise.\nSecond line.", chapter: { title: "Start", body: "It began.\n\n:: not a passage", choices: ["Go left", "Go [[right]]", "Gone"] } });
const story = r.json.story_id, root = r.json.chapter_id;
let choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const fill = async (c, title, extra = {}) => (await call("POST", "/api/chapters", { choice_id: c.id, title, body: `${title} text`, ...extra })).json.chapter_id;
const left = await fill(choices[0], "Left", { choices: ["Deeper"] });
const gone = await fill(choices[2], "Gone chapter");
const deep = await fill((await call("GET", `/api/chapters/${left}`)).json.choices[0], "Deep");
await call("POST", "/api/codex", { anchor_chapter_id: left, op: "create", name: "Mira", content: "A thief.", aliases: ["the thief"], always_include: true });

// Delete one chapter with the command-line tool.
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "admin.mjs");
spawnSync(process.execPath, [script, "delete", "chapter", gone, "--yes"], { env: { ...process.env, STORYTIME_DB: process.env.TEST_DB } });

// ---- Markdown ----
let x = await get(`/api/stories/${story}/export?format=md`);
ok(x.status === 200 && /text\/markdown/.test(x.headers.get("content-type")) && /attachment; filename="the-export-tale\.md"/.test(x.headers.get("content-disposition")), "markdown download has a safe filename");
ok(x.text.startsWith("# The Export: Tale!") && x.text.includes("> A premise.\n> Second line."), "title and premise");
ok(x.text.includes("## 1. Start") && x.text.includes("## 1.1. Left") && x.text.includes("## 1.1.1. Deep"), "chapters are numbered by position in the tree");
ok(x.text.includes("- **Go left** → chapter 1.1") && x.text.includes("- **Go [[right]]** → *(not written yet)*"), "choices point at their chapters, unwritten ones are marked");
ok(!x.text.includes("Gone chapter"), "a deleted chapter is left out");
ok(x.text.includes("- **Gone** → *(not written yet)*"), "a deleted chapter's choice shows as unwritten");
ok(x.text.includes("*The end of this branch.*"), "dead ends are marked");

// ---- Twee ----
x = await get(`/api/stories/${story}/export?format=twee`);
ok(x.status === 200 && /filename="the-export-tale\.twee"/.test(x.headers.get("content-disposition")), "twee download");
ok(x.text.includes(":: StoryTitle\nThe Export: Tale!") && x.text.includes(":: StoryData") && /"ifid": "[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-A[0-9A-F]{3}-[0-9A-F]{12}"/.test(x.text) && x.text.includes('"start": "Start"'), "story header, IFID and start passage");
ok(x.text.includes(":: Start\n") && x.text.includes("[[Go left->Left]]") && x.text.includes(":: Left\n") && x.text.includes("[[Deeper->Deep]]"), "passages and links");
ok(!x.text.includes("right") && !x.text.includes("not written yet") && !x.text.includes("Gone"), "unwritten choices are left out");
ok(!/^:: not a passage/m.test(x.text) && x.text.includes(": : not a passage"), "text can't start a bogus passage");
ok((x.text.match(/^:: /gm) ?? []).length === 5, "exactly the right number of passages (title, data, 3 chapters)");

// ---- JSON ----
x = await get(`/api/stories/${story}/export?format=json`);
const data = JSON.parse(x.text);
ok(data.format === "storytime-export" && data.version === 2 && data.story.title === "The Export: Tale!", "json header");
ok(data.chapters.length === 3 && data.chapters.map((c) => c.title).join() === "Start,Left,Deep", "json chapters in reading order, without deleted ones");
ok(data.choices.length === 4 && data.codex.length === 1 && data.codex[0].aliases[0] === "the thief" && data.codex[0].always_include === true, "json choices and codex");
ok(!x.text.includes("edit_key") && !x.text.includes("author_name"), "no bookkeeping fields in exports");

// ---- errors ----
ok((await get(`/api/stories/${story}/export?format=pdf`)).status === 400, "unknown format 400");
ok((await get(`/api/stories/nope/export`)).status === 404, "unknown story 404");

// ---- outline page ----
x = await get(`/s/${story}/outline`);
const html = x.text.replace(/<!-- -->/g, "");
ok(x.status === 200 && html.includes("Start") && html.includes("Left") && html.includes("Deep"), "outline lists the chapters");
ok(!html.includes("not written yet") && !html.includes("branch ends here"), "outline hides unwritten choices and doesn't tag dead ends");
ok(!html.includes("Gone chapter"), "outline leaves out deleted chapters");
ok(/3 chapters/.test(html) && /2 choices still to write/.test(html), "outline totals: " + (/(\d+ chapters[^<]*)/.exec(html)?.[1] ?? "?"));
ok((await get(`/s/nope/outline`)).status === 404, "outline of an unknown story 404");
const home = (await get(`/`)).text;
ok(home.includes(`/api/stories/${story}/export?format=twee`) && home.includes(`/s/${story}/outline`), "the story list menu links to the outline and downloads");
const viaStory = await fetch(B + `/s/${story}`, { redirect: "manual" });
ok(viaStory.status >= 300 && viaStory.status < 400 && viaStory.headers.get("location").includes("/c/"), "a story's own address goes to its first chapter");

// ---- Twee leaves out unfinished branches ----
// Start -> Pending (only an unwritten choice), and Left -> Deep stays finished.
const pending = (await call("POST", "/api/chapters", { parent_chapter_id: root, new_choice_label: "Wait here", title: "Pending", body: "p", choices: ["Later"] })).json.chapter_id;
const mixed = (await call("POST", "/api/chapters", { parent_chapter_id: left, new_choice_label: "Side road", title: "Side", body: "s", choices: ["Nowhere yet"] })).json.chapter_id;
x = await get(`/api/stories/${story}/export?format=twee`);
ok(pending && mixed && !x.text.includes("Pending") && !x.text.includes("Wait here") && !x.text.includes("Later"), "a branch that only leads to unwritten choices is left out");
ok(!x.text.includes(":: Side") && !x.text.includes("Side road") && x.text.includes("[[Deeper->Deep]]") && x.text.includes(":: Left\n"), "an unfinished side branch is dropped but the finished one stays");
ok((x.text.match(/^:: /gm) ?? []).length === 5, "still only the finished chapters");
// ---- offline HTML ----
x = await get(`/api/stories/${story}/export?format=html`);
ok(x.status === 200 && /text\/html/.test(x.headers.get("content-type")) && /filename="the-export-tale\.html"/.test(x.headers.get("content-disposition")), "html download");
const embedded = JSON.parse(/<script id="story-data" type="application\/json">([\s\S]*?)<\/script>/.exec(x.text)[1]);
const titles = Object.values(embedded.pages).map((p) => p.t).sort().join();
ok(embedded.title === "The Export: Tale!" && embedded.pages[embedded.start].t === "Start" && titles === "Deep,Left,Start", "the embedded story has only the finished chapters: " + titles);
ok(!x.text.includes("Pending") && !x.text.includes("Wait here"), "unfinished branches are left out of the html too");
ok(!x.text.includes(":: not a passage</script>") && (x.text.match(/<\/script>/g) ?? []).length === 2, "story text can't close the script element");
// ---- one route as Markdown ----
x = await get(`/api/stories/${story}/export?format=md&to=${deep}`);
ok(x.status === 200 && /filename="the-export-tale-deep\.md"/.test(x.headers.get("content-disposition")), "path download is named after the story and chapter");
ok(x.text.startsWith("# The Export: Tale!") && x.text.indexOf("## 1. Start") < x.text.indexOf("*Deeper*") && x.text.indexOf("*Deeper*") < x.text.indexOf("## 3. Deep"), "the route reads in order with the choice taken between chapters");
ok(x.text.includes("*Go left*") && !x.text.includes("Go [[right]]") && !x.text.includes("Pending") && x.text.trimEnd().endsWith("*The end.*"), "other branches are left out");
x = await get(`/api/stories/${story}/export?format=md&to=${left}`);
ok(x.text.includes("## 2. Left") && !x.text.includes("Deep text") && x.text.trimEnd().endsWith("*…to be continued.*"), "a chapter that continues is marked as to be continued");
ok((await get(`/api/stories/${story}/export?format=md&to=${gone}`)).status === 404, "a deleted chapter can't be exported");
ok((await get(`/api/stories/${story}/export?format=md&to=nope`)).status === 404, "an unknown chapter is a 404");
ok((await get(`/api/stories/${story}/export?format=twee&to=${deep}`)).status === 400, "to only applies to Markdown");
// the same story in Markdown still shows everything
ok((await get(`/api/stories/${story}/export?format=md`)).text.includes("Pending"), "markdown keeps unfinished branches");

// ---- chapter pictures ----
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const putImage = (id, slot, bytes) => fetch(`${B}/api/chapters/${id}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: bytes });
ok((await putImage(root, "header", png)).status === 200 && (await putImage(deep, "footer", png)).status === 200 && (await putImage(deep, "header", png)).status === 200, "setup: pictures on the first and last chapters");
x = await get(`/api/stories/${story}/export?format=json`);
const withImages = JSON.parse(x.text);
ok(withImages.version === 2 && withImages.images.length === 3, "json carries the pictures");
ok(withImages.images.map((i) => `${i.chapter_id === root ? "root" : "deep"}:${i.slot}`).join() === "root:header,deep:header,deep:footer", "pictures are in reading order, header before footer");
ok(withImages.images.every((i) => i.type === "image/png" && i.data === png.toString("base64")), "each picture is its type and the base64 of what was uploaded");
ok(!x.text.includes('"image":') && !x.text.includes("updated_at"), "no database columns leak into the json pictures");
const noImages = await get(`/api/stories/${story}/export?format=md`);
ok(!noImages.text.includes("base64"), "markdown stays text only");
x = await get(`/api/stories/${story}/export?format=twee`);
ok(!x.text.includes("base64"), "twee stays text only");

const uri = `data:image/png;base64,${png.toString("base64")}`;
x = await get(`/api/stories/${story}/export?format=html`);
const embeddedPics = JSON.parse(/<script id="story-data" type="application\/json">([\s\S]*?)<\/script>/.exec(x.text)[1]);
ok(embeddedPics.pages[embeddedPics.start].h === uri && !embeddedPics.pages[embeddedPics.start].f, "the playable html embeds the first chapter's header as a data: URI");
ok(Object.values(embeddedPics.pages).filter((p) => p.h === uri).length === 2 && Object.values(embeddedPics.pages).filter((p) => p.f === uri).length === 1, "…and the other pictures too");
ok(x.text.includes("chapter-image-header") && x.text.includes("chapter-image-footer") && /max-height:\s*70vh/.test(x.text), "the playable html has the picture markup and style");
x = await get(`/api/stories/${story}/export?format=html&to=${deep}`);
const imgs = x.text.match(/<img [^>]*>/g) ?? [];
ok(imgs.length === 3 && imgs.every((t) => t.includes(`src="${uri}"`) && t.includes('alt=""')), "the route html has an img for each picture, embedded as a data: URI");
const at = (s) => x.text.indexOf(s);
const firstHeader = at('class="chapter-image chapter-image-header"');
ok(firstHeader > 0 && firstHeader < at("<h2>1. Start</h2>"), "a header picture comes before the chapter title");
ok(at("<h2>3. Deep</h2>") < x.text.lastIndexOf('class="chapter-image chapter-image-footer"') && x.text.lastIndexOf('class="chapter-image chapter-image-header"') < at("<h2>3. Deep</h2>"), "…and the footer after the chapter text");
x = await get(`/api/stories/${story}/export?format=html&to=${left}`);
ok((x.text.match(/<img /g) ?? []).length === 1, "a route only shows the pictures of its own chapters");
