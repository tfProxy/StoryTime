// Importing a story from the JSON "everything" export: round trip, and bad files.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const exportOf = async (id) => (await fetch(`${B}/api/stories/${id}/export?format=json`)).json();

let r = await call("POST", "/api/stories", { title: "Round Trip", premise: "A premise.", chapter: { title: "Start", body: "It began.", summary: "sum-root", path_summary: "ps-root", choices: ["Left", "Right"] } });
const story = r.json.story_id, root = r.json.chapter_id;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const left = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Left", body: "left text", summary: "sum-left", path_summary: "ps-left", choices: ["Deeper"] })).json.chapter_id;
await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${left}`)).json.choices[0].id, title: "Deep", body: "deep text" });
await call("POST", "/api/codex", { anchor_chapter_id: left, op: "create", name: "Mira", type: "character", content: "A thief.", aliases: ["the thief"], always_include: true });
r = await call("PATCH", `/api/chapters/${root}`, { base_revision: 1, title: "Start v2", body: "It began again.", edit_note: "polish", summary: "sum-root2", path_summary: "ps-root2" });
ok(r.status === 200, "setup: root chapter edited once");

const data = await exportOf(story);
ok(data.version === 2 && data.revisions.length === 1 && data.revisions[0].title === "Start" && data.chapters[0].edit_note === "polish" && data.chapters[0].path_summary === "ps-root2" && data.chapters[1].summary === "sum-left", "export carries revisions, edit notes and path summaries");

// ---- round trip ----
r = await call("POST", "/api/stories/import", data);
ok(r.status === 201 && r.json.story_id && r.json.story_id !== story && r.json.chapters === 3, "import creates a new story");
const copy = await exportOf(r.json.story_id);
const strip = (d) => {
  const cid = new Map(d.chapters.map((c, i) => [c.id, `c${i}`]));
  const hid = new Map(d.choices.map((c, i) => [c.id, `h${i}`]));
  return JSON.stringify({
    story: { ...d.story, id: 0 },
    chapters: d.chapters.map((c) => ({ ...c, id: cid.get(c.id), parent_choice_id: hid.get(c.parent_choice_id) ?? null })),
    choices: d.choices.map((c) => ({ ...c, id: hid.get(c.id), parent_chapter_id: cid.get(c.parent_chapter_id) })),
    codex: d.codex.map((o) => ({ ...o, id: 0, anchor_chapter_id: cid.get(o.anchor_chapter_id) })),
    revisions: d.revisions.map((o) => ({ ...o, chapter_id: cid.get(o.chapter_id) })),
  });
};
ok(strip(copy) === strip(data), "re-exporting the copy gives the same content (text, summaries, codex, revisions, timestamps)");
ok(!copy.chapters.some((c) => c.id === data.chapters[0].id), "the copy has its own ids");

const page = await fetch(`${B}/c/${r.json.chapter_id}`);
ok(page.status === 200 && (await page.text()).includes("Start v2"), "the imported story can be read");
const listed = (await (await fetch(`${B}/api/stories`)).json()).filter((s) => s.title === "Round Trip");
ok(listed.length === 2, "both copies are listed");

// ---- version 1 files (no revisions) ----
const v1 = { ...data, version: 1 }; delete v1.revisions;
ok((await call("POST", "/api/stories/import", v1)).status === 201, "a version 1 export still imports");

// ---- bad files ----
const bad = async (m, mutate) => { const d = structuredClone(data); mutate(d); const x = await call("POST", "/api/stories/import", d); ok(x.status === 400 && x.json?.error, `rejected: ${m} (${x.json?.error})`); };
await bad("not an export", (d) => { d.format = "other"; });
await bad("newer version", (d) => { d.version = 99; });
await bad("no chapters", (d) => { d.chapters = []; });
await bad("chapter after a missing choice", (d) => { d.chapters[1].parent_choice_id = "nope"; });
await bad("two roots", (d) => { d.chapters[1].parent_choice_id = null; });
await bad("duplicate chapter id", (d) => { d.chapters[1].id = d.chapters[0].id; });
await bad("codex on unknown chapter", (d) => { d.codex[0].anchor_chapter_id = "nope"; });
await bad("choice on unknown chapter", (d) => { d.choices[0].parent_chapter_id = "nope"; });
await bad("too-long title", (d) => { d.chapters[0].title = "x".repeat(500); });
await bad("revision not older than the live one", (d) => { d.revisions[0].revision = 2; });
const before = (await (await fetch(`${B}/api/stories`)).json()).length;
ok((await call("POST", "/api/stories/import", "nonsense")).status === 400, "non-object body rejected");
ok((await (await fetch(`${B}/api/stories`)).json()).length === before, "failed imports leave nothing behind");
