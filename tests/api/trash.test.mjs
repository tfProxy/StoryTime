// The trash: moving a branch out of the story and bringing it back, and Replace branch on the edit PATCH.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const text = async (url) => (await fetch(B + url)).text();

// Root -> "Left" (choices: "Deeper", "Side") and "Right". "Left" -> "Deep" -> "Deepest".
let r = await call("POST", "/api/stories", { title: "Trash tale", premise: "p", chapter: { title: "Root", body: "root body", choices: ["Go left", "Go right", "Go up"] } });
const { story_id: story, chapter_id: root } = r.json;
let [left, right] = (await call("GET", `/api/chapters/${root}`)).json.choices;
const leftCh = (await call("POST", "/api/chapters", { choice_id: left.id, title: "Left ch", body: "left body", choices: ["Deeper", "Side"] })).json.chapter_id;
const rightCh = (await call("POST", "/api/chapters", { choice_id: right.id, title: "Right ch", body: "right body", choices: [] })).json.chapter_id;
const [deeper, side] = (await call("GET", `/api/chapters/${leftCh}`)).json.choices;
const deepCh = (await call("POST", "/api/chapters", { choice_id: deeper.id, title: "Deep ch", body: "deep body", choices: ["Deepest way"] })).json.chapter_id;
const deepest = (await call("GET", `/api/chapters/${deepCh}`)).json.choices[0];
const deepestCh = (await call("POST", "/api/chapters", { choice_id: deepest.id, title: "Deepest ch", body: "deepest body", choices: [] })).json.chapter_id;
const sideCh = (await call("POST", "/api/chapters", { choice_id: side.id, title: "Side ch", body: "side body", choices: [] })).json.chapter_id;

const count = async () => (await call("GET", "/api/stories")).json.find((s) => s.id === story).chapter_count;
const sub = async (id = root, depth = 8) => (await call("GET", `/api/chapters/${id}/subtree?depth=${depth}`)).json;
const titles = (node) => [node.title, ...node.choices.flatMap((c) => (c.child ? titles(c.child) : []))];
ok((await count()) === 6 && titles(await sub()).length === 6, "to start with, the story has six chapters");

// ---- the first chapter stays ----
r = await call("POST", `/api/chapters/${root}/trash`);
ok(r.status === 400 && /first chapter/i.test(r.json.error), "the story's first chapter can't be trashed");
ok((await call("POST", "/api/chapters/nope/trash")).status === 404 && (await call("POST", "/api/chapters/nope/restore")).status === 404, "an unknown chapter is 404");
ok((await call("POST", `/api/chapters/${leftCh}/restore`)).status === 409, "a chapter that is not in the trash can't be restored");

// ---- trashing a nested branch, then its parent ----
r = await call("POST", `/api/chapters/${deepCh}/trash`);
ok(r.status === 200 && r.json.trashed === 2 && r.json.parent_chapter_id === leftCh, "Deep and what is below it are trashed: " + JSON.stringify(r.json));
ok((await call("POST", `/api/chapters/${deepCh}/trash`)).status === 409, "…and it can't be trashed twice");
ok((await count()) === 4, "the story's chapter count leaves them out");
let tree = await sub();
ok(JSON.stringify(titles(tree)) === JSON.stringify(["Root", "Left ch", "Side ch", "Right ch"]), "the tree leaves them out: " + titles(tree));
let g = await call("GET", `/api/chapters/${leftCh}`);
ok(g.json.choices.find((c) => c.id === deeper.id).child_chapter_id === null, "the parent's choice shows no chapter written");
ok((await call("GET", `/api/chapters/${deepCh}`)).json.chapter.trashed_at > 0, "a trashed chapter can still be opened by id");
ok((await call("GET", `/api/chapters/${deepCh}/context`)).json.trashed === true && (await call("GET", `/api/chapters/${leftCh}/context`)).json.trashed === false, "its context says it is trashed");
r = await call("PATCH", `/api/chapters/${deepCh}`, { base_revision: 1, title: "x", body: "y" });
ok(r.status === 409 && /trash/i.test(r.json.error), "a trashed chapter can't be edited");
r = await call("POST", "/api/chapters", { parent_chapter_id: deepCh, new_choice_label: "Nope", title: "N", body: "n" });
ok(r.status === 409, "nothing can be written below a trashed chapter");
r = await call("PATCH", `/api/chapters/${leftCh}`, { base_revision: 1, title: "Left ch", body: "left body", remove_choices: [deeper.id] });
ok(r.status === 409 && /trash/i.test(r.json.error), "a choice with a chapter in the trash can't be removed");

// A new chapter can be written under that choice, while the old one is in the trash.
r = await call("POST", "/api/chapters", { choice_id: deeper.id, title: "Deep again", body: "new deep", choices: [] });
ok(r.status === 201, "a new chapter can be written under the choice");
const deepAgain = r.json.chapter_id;
ok((await count()) === 5, "…and counts");

// Trash Left: Deep again and Side go with it; Deep (older) keeps its own time.
r = await call("POST", `/api/chapters/${leftCh}/trash`);
ok(r.status === 200 && r.json.trashed === 3 && r.json.parent_chapter_id === root, "trashing Left takes Left, Deep again and Side (not Deep): " + JSON.stringify(r.json));
ok((await count()) === 2 && JSON.stringify(titles(await sub())) === JSON.stringify(["Root", "Right ch"]), "only Root and Right are left");
const deepTime = (await call("GET", `/api/chapters/${deepCh}`)).json.chapter.trashed_at;
const leftTime = (await call("GET", `/api/chapters/${leftCh}`)).json.chapter.trashed_at;
ok(deepTime !== leftTime && deepTime < leftTime, "the older branch keeps its own time");

// ---- exports and other story-wide lists skip trashed chapters ----
const md = await text(`/api/stories/${story}/export?format=md`);
ok(md.includes("Right ch") && !md.includes("Left ch") && !md.includes("Deep") && !md.includes("Side ch"), "the Markdown export leaves them out");
const json = JSON.parse(await text(`/api/stories/${story}/export?format=json`));
ok(json.chapters.length === 2, "…and so does the JSON export");
const outline = await text(`/s/${story}/outline`);
ok(outline.includes("Right ch") && !outline.includes("Left ch") && !outline.includes("outline-trashed"), "the outline leaves them out by default");
r = await call("GET", "/api/settings");
// (settings are null until something saves them; then the part is off unless the owner turned it on)
ok(!(r.json.settings?.outline?.trashed ?? false), "…because the outline's Trashed branches part is off by default");

// ---- restoring: the parent first (the older branch stays in the trash) ----
r = await call("POST", `/api/chapters/${deepCh}/restore`);
ok(r.status === 409 && /Left ch/.test(r.json.error), "Deep can't come back while Left is in the trash");
r = await call("POST", `/api/chapters/${leftCh}/restore`);
ok(r.status === 200 && r.json.restored === 3 && r.json.choice_id === left.id, "restoring Left brings back Left, Deep again and Side: " + JSON.stringify(r.json));
ok((await count()) === 5, "…and not Deep");
ok((await call("GET", `/api/chapters/${deepCh}`)).json.chapter.trashed_at === deepTime, "Deep is still in the trash");

// ---- restoring into a taken choice makes "<label> (old)" ----
r = await call("POST", `/api/chapters/${deepCh}/restore`);
ok(r.status === 200 && r.json.restored === 2 && r.json.choice_id !== deeper.id, "Deep comes back, on a new choice: " + JSON.stringify(r.json));
g = await call("GET", `/api/chapters/${leftCh}`);
const old = g.json.choices.find((c) => c.id === r.json.choice_id);
ok(old && old.label === "Deeper (old)" && old.child_chapter_id === deepCh, "…labelled “Deeper (old)” and holding Deep");
ok(g.json.choices.find((c) => c.id === deeper.id).child_chapter_id === deepAgain, "the original choice keeps the new chapter");
ok((await count()) === 7 && (await sub()).choices.length === 3, "everything is back: seven chapters");
const p = (await call("GET", `/api/chapters/${deepestCh}`)).json.path.map((c) => c.title);
ok(JSON.stringify(p) === JSON.stringify(["Root", "Left ch", "Deep ch", "Deepest ch"]), "Deepest's path runs through the moved Deep: " + p);

// A choice list that is full can't take the "(old)" choice.
const small = await call("POST", "/api/stories", { title: "Full tale", chapter: { title: "R", body: "r", choices: Array.from({ length: 12 }, (_, i) => `Way ${i}`) } });
const fullRoot = small.json.chapter_id;
const way0 = (await call("GET", `/api/chapters/${fullRoot}`)).json.choices[0];
const first = (await call("POST", "/api/chapters", { choice_id: way0.id, title: "First", body: "f" })).json.chapter_id;
await call("POST", `/api/chapters/${first}/trash`);
await call("POST", "/api/chapters", { choice_id: way0.id, title: "Second", body: "s" });
r = await call("POST", `/api/chapters/${first}/restore`);
ok(r.status === 409 && /room|choice/i.test(r.json.error), "no room for the (old) choice is a 409: " + (r.json && r.json.error));

// A run can't start at a trashed chapter.
await call("POST", `/api/chapters/${sideCh}/trash`);
r = await call("POST", "/api/ai-runs", { story_id: story, start_chapter_id: sideCh, mode: "fill", options: {}, tasks: [] });
ok(r.status === 409 && /trash/i.test(r.json.error), "an AI run can't start at a trashed chapter");
await call("POST", `/api/chapters/${sideCh}/restore`);

// ---- Replace branch ----
const before = (await call("GET", `/api/chapters/${leftCh}`)).json;
r = await call("PATCH", `/api/chapters/${leftCh}`, { base_revision: before.chapter.revision, title: "Left ch v2", body: "left body v2", replace_branch: true });
ok(r.status === 200 && r.json.revision === before.chapter.revision + 1 && r.json.trashed === 4, "Replace branch saves and trashes what is below: " + JSON.stringify(r.json));
g = await call("GET", `/api/chapters/${leftCh}`);
ok(g.json.chapter.title === "Left ch v2" && g.json.chapter.trashed_at === null, "the chapter itself stays, edited");
ok(g.json.choices.length === 3 && g.json.choices.every((c) => c.child_chapter_id === null), "its choices stay, now unwritten");
const rev = await call("GET", `/api/chapters/${leftCh}/revisions`);
ok(rev.status === 200 && JSON.stringify(rev.json).includes("left body"), "the old text is in its history");
ok((await count()) === 3, "the chapters below are in the trash");
const times = new Set((await Promise.all([deepAgain, deepCh, sideCh, deepestCh].map(async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter.trashed_at))));
ok(times.size === 1, "…all with the same time");
r = await call("PATCH", `/api/chapters/${leftCh}`, { base_revision: before.chapter.revision + 1, title: "Left ch v3", body: "b", replace_branch: true });
ok(r.status === 200 && r.json.trashed === 0, "replacing a branch with nothing below trashes nothing");
// Each child came back as its own branch.
r = await call("POST", `/api/chapters/${deepAgain}/restore`);
ok(r.status === 200 && r.json.restored === 1 && r.json.choice_id === deeper.id, "a child trashed by Replace branch restores on its own choice");
