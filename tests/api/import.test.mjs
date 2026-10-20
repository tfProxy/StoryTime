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

// ---- the art style ----
ok(data.story.art_style === "", "setup: the original has no art style");
await call("PATCH", `/api/stories/${story}`, { art_style: "Ink and wash, muted colours" });
const styled = await exportOf(story);
r = await call("POST", "/api/stories/import", styled);
ok(r.status === 201 && (await exportOf(r.json.story_id)).story.art_style === "Ink and wash, muted colours", "the art style round-trips");
const noArt = structuredClone(styled); delete noArt.story.art_style;
r = await call("POST", "/api/stories/import", noArt);
ok(r.status === 201 && (await exportOf(r.json.story_id)).story.art_style === "", "a file without an art style imports with none");
await call("PATCH", `/api/stories/${story}`, { art_style: "" });

// ---- the prompt style and checkpoint ----
ok(data.story.image_prompt_style === null && data.story.checkpoint === "", "setup: the original has no prompt style or checkpoint chosen");
await call("PATCH", `/api/stories/${story}`, { image_prompt_style: "natural", checkpoint: "sdxl/juggernaut.safetensors" });
const pictured = await exportOf(story);
r = await call("POST", "/api/stories/import", pictured);
const back = (await exportOf(r.json.story_id)).story;
ok(r.status === 201 && back.image_prompt_style === "natural" && back.checkpoint === "sdxl/juggernaut.safetensors", "the prompt style and checkpoint round-trip");
const older = structuredClone(pictured); delete older.story.image_prompt_style; delete older.story.checkpoint;
r = await call("POST", "/api/stories/import", older);
const olderBack = (await exportOf(r.json.story_id)).story;
ok(r.status === 201 && olderBack.image_prompt_style === null && olderBack.checkpoint === "", "a file from before them imports with neither chosen");
ok((await call("PATCH", `/api/stories/${story}`, { image_prompt_style: "pictures" })).status === 400, "a prompt style other than tags or natural is refused");
await call("PATCH", `/api/stories/${story}`, { image_prompt_style: null, checkpoint: "" });
ok((await exportOf(story)).story.image_prompt_style === null, "the prompt style can be unset again");

// ---- version 1 files (no revisions) ----
const v1 = { ...data, version: 1 }; delete v1.revisions;
ok((await call("POST", "/api/stories/import", v1)).status === 201, "a version 1 export still imports");

// ---- chapter pictures ----
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 7)]);
const putImage = (id, slot, bytes) => fetch(`${B}/api/chapters/${id}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
ok((await putImage(root, "header", png)).status === 200 && (await putImage(left, "footer", jpeg)).status === 200, "setup: a header on the first chapter and a footer on the second");
const withPics = await exportOf(story);
ok(withPics.images.length === 2, "export has the two pictures");
r = await call("POST", "/api/stories/import", withPics);
ok(r.status === 201, "a story with pictures imports");
const copyPics = await exportOf(r.json.story_id);
const pictureAt = async (chapterId, slot) => {
  const res = await fetch(`${B}/api/chapters/${chapterId}/images/${slot}`);
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
};
let pic = await pictureAt(r.json.chapter_id, "header");
ok(pic.status === 200 && pic.type === "image/png" && pic.bytes.equals(png), "the copy's first chapter has the same header picture");
pic = await pictureAt(copyPics.chapters[1].id, "footer");
ok(pic.status === 200 && pic.type === "image/jpeg" && pic.bytes.equals(jpeg), "the copy's second chapter has the same footer picture");
ok((await pictureAt(r.json.chapter_id, "footer")).status === 404 && (await pictureAt(copyPics.chapters[1].id, "header")).status === 404, "slots without a picture stay empty");
ok(copyPics.images.length === 2 && copyPics.images.every((i) => i.chapter_id !== root && i.chapter_id !== left), "the pictures belong to the copy's own chapters");
ok((await pictureAt(root, "header")).bytes.equals(png), "the original's picture is untouched");
// the file's claimed type doesn't matter: it is detected from the bytes
const mislabeled = structuredClone(withPics); mislabeled.images[0].type = "text/html";
r = await call("POST", "/api/stories/import", mislabeled);
ok(r.status === 201 && (await pictureAt(r.json.chapter_id, "header")).type === "image/png", "the picture type comes from the picture, not the file's claim");
// files from before pictures existed
const noPics = structuredClone(withPics); delete noPics.images;
r = await call("POST", "/api/stories/import", noPics);
ok(r.status === 201 && (await pictureAt(r.json.chapter_id, "header")).status === 404, "an export without pictures still imports");
// files from before pictures remembered their prompts
const noPrompts = structuredClone(withPics);
for (const i of noPrompts.images) { delete i.prompt; delete i.negative; }
r = await call("POST", "/api/stories/import", noPrompts);
ok(r.status === 201 && (await pictureAt(r.json.chapter_id, "header")).status === 200, "an export whose pictures have no prompts still imports");
ok((await exportOf(r.json.story_id)).images.every((i) => i.prompt === null && i.negative === null), "…and its pictures have no prompts");

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
const badPics = async (m, mutate) => { const d = structuredClone(withPics); mutate(d); const x = await call("POST", "/api/stories/import", d); ok(x.status === 400 && x.json?.error, `rejected: ${m} (${x.json?.error})`); };
await badPics("picture for a chapter that isn't in the file", (d) => { d.images[0].chapter_id = "nope"; });
await badPics("two pictures for one slot", (d) => { d.images.push({ ...d.images[0] }); });
await badPics("picture that isn't an image", (d) => { d.images[0].data = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64"); });
await badPics("picture that is empty after decoding", (d) => { d.images[0].data = "="; });
await badPics("picture over 4 MB", (d) => { d.images[0].data = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]).toString("base64"); });
await badPics("unknown slot", (d) => { d.images[0].slot = "sidebar"; });
const before = (await (await fetch(`${B}/api/stories`)).json()).length;
ok((await call("POST", "/api/stories/import", "nonsense")).status === 400, "non-object body rejected");
ok((await (await fetch(`${B}/api/stories`)).json()).length === before, "failed imports leave nothing behind");
