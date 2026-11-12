// Moving where a codex entry first appears: GET/POST /api/codex/move-start. Earlier always works and takes the first
// version along; later refuses facts in between (unless they move too), changes on another branch, and drafts.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// root -> A -> B -> C -> D ; B -> B2
let r = await call("POST", "/api/stories", { title: "Starts", chapter: { title: "Root", body: "r", choices: ["A"] } });
const story = r.json.story_id, root = r.json.chapter_id;
const fill = async (from, title, choices = [], n = 0) => (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${from}`)).json.choices[n].id, title, body: title, choices })).json.chapter_id;
const a = await fill(root, "A", ["B"]);
const b = await fill(a, "B", ["C", "B2"]);
const c = await fill(b, "C", ["D"]);
const d = await fill(c, "D");
const b2 = await fill(b, "B2", [], 1);

const rowan = (await call("POST", "/api/codex", { anchor_chapter_id: a, op: "create", name: "Rowan", type: "character" })).json.entry_id;
const fact = async (anchor, aspect, text) => (await call("POST", "/api/codex/facts", { anchor_chapter_id: anchor, entry_id: rowan, op: "set", aspect, text })).json.fact_id;
await fact(a, "Ears", "Round ears.");
await fact(b, "Hair", "Red hair.");
await fact(d, "Eyes", "Green eyes.");
const pic = await fetch(`${B}/api/stories/${story}/codex-icons/${rowan}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
ok(pic.ok, "Rowan has an icon");

const at = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json;
const entryAt = async (id) => (await at(id)).entries.find((e) => e.entry_id === rowan);
const aspects = (e) => e.facts.map((f) => f.aspect).sort().join(",");
const move = (body) => call("POST", "/api/codex/move-start", { entry_id: rowan, from_chapter_id: d, ...body });

// ---- what the picker offers ----
r = await call("GET", `/api/codex/move-start?entry_id=${rowan}&chapter_id=${d}`);
ok(r.status === 200 && r.json.chapter_id === a && r.json.number === 2 && r.json.first_facts === 1 && r.json.later_facts === 2, "the start is A, with one fact entered with it and two later: " + JSON.stringify({ ...r.json, options: undefined }));
const opt = (id) => r.json.options.find((o) => o.chapter_id === id);
ok(r.json.options.map((o) => o.chapter_id).join() === [root, a, b, c, d].join(), "the line from the first chapter to D is offered");
ok(opt(a).relation === "now" && !opt(a).allowed, "A is the start now");
ok(opt(root).relation === "earlier" && opt(root).allowed, "Root (earlier) is allowed");
ok(opt(b).allowed && opt(b).between.length === 0 && opt(b).leaves === 0, "B (later) is allowed with nothing in between");
ok(opt(c).allowed && opt(c).between.length === 1 && opt(c).between[0].label.startsWith("Hair") && opt(c).leaves === 1, "C has the Hair fact in between and leaves B2 behind: " + JSON.stringify(opt(c)));
ok((await call("GET", `/api/codex/move-start?entry_id=${rowan}&chapter_id=${a}`)).json.options.map((o) => o.chapter_id).join() === [root, a, b].join(), "viewed at A, the line goes on only while there is one next chapter");

// ---- earlier ----
r = await move({ to_chapter_id: root });
ok(r.status === 201 && r.json.chapter_id === root, "moving earlier works: " + JSON.stringify(r.json));
let e = await entryAt(root);
ok(e && aspects(e) === "Ears", "at Root it reads with the fact entered with it, not the later ones");
ok(aspects(await entryAt(d)) === "Ears,Eyes,Hair", "the later facts stay where they were");
const create = (await at(d)).ops.find((o) => o.entry_id === rowan && o.op === "create");
ok(create.anchor_chapter_id === root && create.moved_from_chapter_id === a && create.moved_from_title === "A", "the create records where it moved from");
ok((await call("GET", `/api/stories/${story}/codex-icons`)).json.icons[rowan] > 0, "the icon stays, as it belongs to no chapter");

// ---- later ----
r = await move({ to_chapter_id: a });
ok(r.status === 201, "moving later with nothing in between works");
r = await move({ to_chapter_id: c });
ok(r.status === 409 && r.json.between?.length === 1 && r.json.between[0].chapter_title === "B", "moving later past a fact asks first, listing it: " + JSON.stringify(r.json));
ok((await entryAt(a)) !== undefined, "…and nothing moved");
r = await move({ to_chapter_id: c, move_between: true });
ok(r.status === 201, "…unless the facts in between move too");
ok((await entryAt(b)) === undefined && (await entryAt(b2)) === undefined, "it isn't at B or B2 any more");
e = await entryAt(c);
ok(e && aspects(e) === "Ears,Hair", "at C it has the first version and the moved fact");

r = await move({ to_chapter_id: b });
ok(r.status === 201, "moving back earlier works");
await fact(b2, "Scar", "A scar.");
r = await move({ to_chapter_id: c });
ok(r.status === 400 && r.json.error.includes("B2"), "moving later is refused while another branch changes the entry: " + r.json?.error);

// ---- refusals ----
r = await call("POST", "/api/codex/move-start", { entry_id: rowan, from_chapter_id: b2, to_chapter_id: d });
ok(r.status === 400 && r.json.error.includes("B2"), "seen from B2, moving later to D would leave B2's change behind: " + r.json?.error);
r = await move({ to_chapter_id: b });
ok(r.status === 409, "moving to where it starts now is refused");
r = await move({ from_chapter_id: "draft", to_chapter_id: root });
ok(r.status === 400 && /posted/.test(r.json.error), "the drafting page's unposted chapter is refused: " + r.json?.error);
r = await call("POST", "/api/codex/move-start", { entry_id: "draft-1", from_chapter_id: d, to_chapter_id: root });
ok(r.status === 400, "an entry only in a draft is refused");
r = await move({ to_chapter_id: "nope" });
ok(r.status === 400, "an unknown target is refused");

// An earlier life of the entry is in the way: removed at C and added again at D.
const kit = (await call("POST", "/api/codex", { anchor_chapter_id: a, op: "create", name: "Kit", type: "character" })).json.entry_id;
await call("POST", "/api/codex", { anchor_chapter_id: c, op: "retire", entry_id: kit, name: "Kit" });
const kit2 = (await call("POST", "/api/codex", { anchor_chapter_id: d, op: "create", name: "Kit", type: "character" })).json.entry_id;
r = await call("POST", "/api/codex/move-start", { entry_id: kit2, from_chapter_id: d, to_chapter_id: b2 });
ok(r.status === 400 && r.json.error.includes("isn't before or after"), "a chapter neither before nor after the start is refused: " + r.json?.error);
r = await call("POST", "/api/codex/move-start", { entry_id: kit2, from_chapter_id: d, to_chapter_id: b });
ok(r.status === 400 && r.json.error.includes("Another entry"), "a chapter where another entry has the same name is refused: " + r.json?.error);
r = await call("POST", "/api/codex/move-start", { entry_id: kit, from_chapter_id: b, to_chapter_id: d });
ok(r.status === 400 && r.json.error.includes("removed"), "moving later past where the entry is removed is refused: " + r.json?.error);

// A draft holding changes to the entry blocks moving it later (they'd be saved where it no longer is).
const ivy = (await call("POST", "/api/codex", { anchor_chapter_id: a, op: "create", name: "Ivy", type: "character" })).json.entry_id;
const key = `edit:${a}`;
const draftUrl = `/api/drafts/${encodeURIComponent(key)}`;
r = await call("PUT", draftUrl, { draft: { key, href: "/x", label: "Edit", title: "A (edit)", body: "A", storyTitle: "", codexFactChanges: [{ entry_id: ivy, op: "set", aspect: "Mood", text: "Calm." }] }, base: null });
ok(r.status === 200, "a draft holding a change to Ivy is saved");
r = await call("POST", "/api/codex/move-start", { entry_id: ivy, from_chapter_id: d, to_chapter_id: b });
ok(r.status === 400 && r.json.error.includes("A (edit)"), "moving later is refused while a draft holds changes to the entry: " + r.json?.error);
r = await call("POST", "/api/codex/move-start", { entry_id: ivy, from_chapter_id: d, to_chapter_id: root });
ok(r.status === 201, "…but moving earlier is fine");
await call("DELETE", draftUrl);
r = await call("POST", "/api/codex/move-start", { entry_id: ivy, from_chapter_id: d, to_chapter_id: b });
ok(r.status === 201, "once the draft is gone, moving later works");
