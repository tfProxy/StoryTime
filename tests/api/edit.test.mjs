const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const K1 = "key-one-0123456789abcdef", K2 = "key-two-0123456789abcdef", K3 = "key-three-0123456789abcd";

let r = await call("POST", "/api/stories", { title: "S", premise: "p", author_name: "A", chapter: { title: "Root", body: "root body", edit_key: K1, path_summary: "ps-root", choices: ["Left", "Right", "Spare"] } });
const root = r.json.chapter_id, story = r.json.story_id;
let g = await call("GET", `/api/chapters/${root}`);
const [left, right, spare] = g.json.choices;
ok(g.json.chapter.revision === 1 && g.json.chapter.edit_key_hash === undefined && !JSON.stringify(g.json).includes("edit_key"), "GET exposes revision, never the key hash");
r = await call("POST", "/api/chapters", { choice_id: left.id, title: "Left ch", body: "left body", edit_key: K2, path_summary: "ps-left", choices: ["Deeper"] });
const leftCh = r.json.chapter_id;
g = await call("GET", `/api/chapters/${leftCh}`);
r = await call("POST", "/api/chapters", { choice_id: g.json.choices[0].id, title: "Deep", body: "deep body", edit_key: K3, path_summary: "ps-deep" });
const deep = r.json.chapter_id;
r = await call("POST", "/api/chapters", { parent_chapter_id: root, new_choice_label: "Climb", title: "No key", body: "nk" });
const noKey = r.json.chapter_id;

const edit = (id, key, extra = {}) => call("PATCH", `/api/chapters/${id}`, { edit_key: key, base_revision: 1, title: "T2", body: "b2", edited_by: "Eve", ...extra });
r = await edit(root, K2); ok(r.status === 403, "wrong key rejected: " + r.json?.error);
r = await edit(noKey, K1); ok(r.status === 403, "chapter posted without key can't be edited");
r = await edit("nope", K1); ok(r.status === 404, "missing chapter 404");
r = await edit(root, K1, { edit_note: "tighten", incoming_label: "ignored for root", rename_choices: [{ id: left.id, label: "Go left" }], remove_choices: [spare.id], add_choices: ["Wait"] });
ok(r.status === 200 && r.json.revision === 2, "edit with right key: " + JSON.stringify(r.json));
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.chapter.title === "T2" && g.json.chapter.revision === 2 && g.json.chapter.edited_by === "Eve" && g.json.chapter.edit_note === "tighten" && g.json.chapter.author_name === "", "chapter updated, original author untouched");
const labels = g.json.choices.map((c) => c.label);
ok(JSON.stringify(labels) === JSON.stringify(["Go left", "Right", "Climb", "Wait"]), "choices renamed/removed/added: " + labels);
ok(g.json.choices[0].child_chapter_id === leftCh, "renamed choice still points at its child");
let rev = await call("GET", `/api/chapters/${root}/revisions`);
ok(rev.json.length === 1 && rev.json[0].revision === 1 && rev.json[0].title === "Root" && rev.json[0].body === "root body", "revision 1 preserved");
const d = (await call("GET", `/api/chapters/${deep}`)).json.chapter, l = (await call("GET", `/api/chapters/${leftCh}`)).json.chapter;
ok(d.path_summary === null && l.path_summary === null, "descendant path_summary cleared");
ok((await call("GET", `/api/chapters/${root}`)).json.chapter.path_summary === null, "edited chapter takes the summary supplied (none)");

r = await edit(root, K1); ok(r.status === 409, "stale base_revision conflicts: " + r.json?.error);
r = await call("PATCH", `/api/chapters/${root}`, { edit_key: K1, base_revision: 2, title: "T3", body: "b3", remove_choices: [left.id] });
ok(r.status === 409 && /already has a chapter/.test(r.json.error), "can't remove choice with a chapter: " + r.json?.error);
g = await call("GET", `/api/chapters/${root}`); ok(g.json.chapter.revision === 2 && g.json.chapter.title === "T2", "failed edit rolled back completely");
r = await call("PATCH", `/api/chapters/${root}`, { edit_key: K1, base_revision: 2, title: "T3", body: "b3", rename_choices: [{ id: "bogus", label: "x" }] });
ok(r.status === 400, "foreign choice id rejected");

// incoming label edited by the child's key
r = await call("PATCH", `/api/chapters/${leftCh}`, { edit_key: K2, base_revision: 1, title: "Left 2", body: "lb2", incoming_label: "Veer left" });
ok(r.status === 200, "child edit ok");
g = await call("GET", `/api/chapters/${root}`); ok(g.json.choices[0].label === "Veer left", "incoming choice label updated via child key");
r = await call("PATCH", `/api/chapters/${leftCh}`, { edit_key: K2, base_revision: 2, title: "", body: "x" }); ok(r.status === 400, "validation: empty title");

// story meta
r = await call("PATCH", `/api/stories/${story}`, { edit_key: K2, title: "New", premise: "np" }); ok(r.status === 403, "story edit needs the root chapter's key");
r = await call("PATCH", `/api/stories/${story}`, { edit_key: K1, title: "New Title", premise: "np" }); ok(r.status === 200, "story edit with root key");
ok((await call("GET", `/api/stories/${story}`)).json.title === "New Title", "story title changed");

// pages render
for (const u of [`/c/${root}`, `/c/${root}/edit`, `/c/${root}/history`, `/c/${leftCh}/history`]) { const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`); }
const h = (await (await fetch(`${B}/c/${root}/history`)).text()).replace(/<!-- -->/g, "");
ok(h.includes("Revision 1") && h.includes("root body"), "history page shows revision 1 text");
