const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

let r = await call("POST", "/api/stories", { title: "S", premise: "p", chapter: { title: "Root", body: "root body", path_summary: "ps-root", choices: ["Left", "Right", "Spare"] } });
const root = r.json.chapter_id, story = r.json.story_id;
let g = await call("GET", `/api/chapters/${root}`);
const [left, right, spare] = g.json.choices;
ok(g.json.chapter.revision === 1, "GET exposes the revision");
r = await call("POST", "/api/chapters", { choice_id: left.id, title: "Left ch", body: "left body", path_summary: "ps-left", choices: ["Deeper"] });
const leftCh = r.json.chapter_id;
g = await call("GET", `/api/chapters/${leftCh}`);
r = await call("POST", "/api/chapters", { choice_id: g.json.choices[0].id, title: "Deep", body: "deep body", path_summary: "ps-deep" });
const deep = r.json.chapter_id;
await call("POST", "/api/chapters", { parent_chapter_id: root, new_choice_label: "Climb", title: "Climb ch", body: "cc" });

const edit = (id, extra = {}) => call("PATCH", `/api/chapters/${id}`, { base_revision: 1, title: "T2", body: "b2", ...extra });
r = await edit("nope"); ok(r.status === 404, "missing chapter 404");
r = await edit(root, { edit_note: "tighten", incoming_label: "ignored for root", rename_choices: [{ id: left.id, label: "Go left" }], remove_choices: [spare.id], add_choices: ["Wait"] });
ok(r.status === 200 && r.json.revision === 2, "edit ok: " + JSON.stringify(r.json));
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.chapter.title === "T2" && g.json.chapter.revision === 2 && g.json.chapter.edit_note === "tighten", "chapter updated");
const labels = g.json.choices.map((c) => c.label);
ok(JSON.stringify(labels) === JSON.stringify(["Go left", "Right", "Climb", "Wait"]), "choices renamed/removed/added: " + labels);
ok(g.json.choices[0].child_chapter_id === leftCh, "renamed choice still points at its child");
let rev = await call("GET", `/api/chapters/${root}/revisions`);
ok(rev.json.length === 1 && rev.json[0].revision === 1 && rev.json[0].title === "Root" && rev.json[0].body === "root body", "revision 1 preserved");
const d = (await call("GET", `/api/chapters/${deep}`)).json.chapter, l = (await call("GET", `/api/chapters/${leftCh}`)).json.chapter;
ok(d.path_summary === null && l.path_summary === null, "descendant path_summary cleared");
ok((await call("GET", `/api/chapters/${root}`)).json.chapter.path_summary === null, "edited chapter takes the summary supplied (none)");

r = await edit(root); ok(r.status === 409, "stale base_revision conflicts: " + r.json?.error);
r = await call("PATCH", `/api/chapters/${root}`, { base_revision: 2, title: "T3", body: "b3", remove_choices: [left.id] });
ok(r.status === 409 && /already has a chapter/.test(r.json.error), "can't remove choice with a chapter: " + r.json?.error);
g = await call("GET", `/api/chapters/${root}`); ok(g.json.chapter.revision === 2 && g.json.chapter.title === "T2", "failed edit rolled back completely");
r = await call("PATCH", `/api/chapters/${root}`, { base_revision: 2, title: "T3", body: "b3", rename_choices: [{ id: "bogus", label: "x" }] });
ok(r.status === 400, "foreign choice id rejected");

// incoming label edited from the child chapter
r = await call("PATCH", `/api/chapters/${leftCh}`, { base_revision: 1, title: "Left 2", body: "lb2", incoming_label: "Veer left" });
ok(r.status === 200, "child edit ok");
g = await call("GET", `/api/chapters/${root}`); ok(g.json.choices[0].label === "Veer left", "incoming choice label updated via the child");
r = await call("PATCH", `/api/chapters/${leftCh}`, { base_revision: 2, title: "", body: "x" }); ok(r.status === 400, "validation: empty title");

// story meta
r = await call("PATCH", `/api/stories/${story}`, { title: "New Title", premise: "np" }); ok(r.status === 200, "story edit");
ok((await call("GET", `/api/stories/${story}`)).json.title === "New Title", "story title changed");

// pages render
for (const u of [`/c/${root}`, `/c/${root}/edit`, `/c/${root}/history`, `/c/${leftCh}/history`]) { const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`); }
const h = (await (await fetch(`${B}/c/${root}/history`)).text()).replace(/<!-- -->/g, "");
ok(h.includes("Revision 1") && h.includes("root body"), "history page shows revision 1 text");

// ---- removing one unwritten choice (DELETE /api/chapters/:id/choices/:choiceId) ----
{
  const s = (await call("POST", "/api/stories", { title: "Rm", premise: "p", chapter: { title: "R", body: "b", path_summary: "ps", choices: ["Open", "Done"] } })).json;
  const [open, done] = (await call("GET", `/api/chapters/${s.chapter_id}`)).json.choices;
  await call("POST", "/api/chapters", { choice_id: done.id, title: "D", body: "d", path_summary: "pd" });
  let x = await call("DELETE", `/api/chapters/${s.chapter_id}/choices/${done.id}`);
  ok(x.status === 409, "a written choice can't be removed");
  x = await call("DELETE", `/api/chapters/${s.chapter_id}/choices/nope`);
  ok(x.status === 404, "an unknown choice is a 404");
  x = await call("DELETE", `/api/chapters/${s.chapter_id}/choices/${open.id}`);
  ok(x.status === 200, "an unwritten choice is removed");
  ok((await call("GET", `/api/chapters/${s.chapter_id}`)).json.choices.length === 1, "only the written choice is left");
}

// ---- removing a choice also deletes its draft (both from the reading page and from the edit page) ----
{
  const s = (await call("POST", "/api/stories", { title: "RmDraft", premise: "p", chapter: { title: "R", body: "b", path_summary: "ps", choices: ["One", "Two", "Kept"] } })).json;
  const [one, two, kept] = (await call("GET", `/api/chapters/${s.chapter_id}`)).json.choices;
  const draftUrl = (c) => `/api/drafts/${encodeURIComponent(`fill:${c.id}`)}`;
  for (const c of [one, two, kept]) await call("PUT", draftUrl(c), { draft: { key: `fill:${c.id}`, href: "/", label: c.label, body: "started" }, base: null });
  ok((await call("GET", draftUrl(one))).status === 200, "a choice's draft is saved");
  await call("DELETE", `/api/chapters/${s.chapter_id}/choices/${one.id}`);
  ok((await call("GET", draftUrl(one))).status === 404, "removing the choice deletes its draft");
  const x = await call("PATCH", `/api/chapters/${s.chapter_id}`, { base_revision: 1, title: "R", body: "b", remove_choices: [two.id] });
  ok(x.status === 200, "the edit page removes a choice");
  ok((await call("GET", draftUrl(two))).status === 404, "…and its draft goes too");
  ok((await call("GET", draftUrl(kept))).status === 200, "other choices' drafts stay");
  await call("DELETE", draftUrl(kept));
}
