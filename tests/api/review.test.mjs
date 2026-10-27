// Free review checks: missing and stale chapter summaries.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("POST", "/api/stories", { title: "Review", chapter: { title: "Root", body: "root", summary: "root sum", choices: ["A", "B", "C", "D"] } });
const story = r.json.story_id, root = r.json.chapter_id;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const post = async (choice, title, extra = {}) => (await call("POST", "/api/chapters", { choice_id: choice.id, title, body: title + " body", ...extra })).json.chapter_id;
const withSummary = await post(choices[0], "Has summary", { summary: "has sum" });
const noSummary = await post(choices[1], "No summary");
const stale = await post(choices[2], "Stale", { summary: "stale sum" });
const fresh = await post(choices[3], "Fresh", { summary: "fresh sum" });

const issues = async () => (await call("GET", `/api/stories/${story}/review`)).json.issues;
const of = (list, id) => list.filter((i) => i.chapterId === id);

let list = await issues();
ok(of(list, root).length === 0 && of(list, withSummary).length === 0, "chapters posted with a summary have no issue");
ok(of(list, noSummary).length === 1 && of(list, noSummary)[0].kind === "summary-missing", "chapter posted without a summary is summary-missing");
ok(of(list, noSummary)[0].title === "No summary" && of(list, noSummary)[0].depth === 1 && !!of(list, noSummary)[0].message, "issue carries title, depth and message");

// Body changed, same summary.
r = await call("PATCH", `/api/chapters/${stale}`, { base_revision: 1, title: "Stale", body: "new text", summary: "stale sum" });
ok(r.status === 200, "edit with unchanged summary ok");
// Body changed, new summary.
r = await call("PATCH", `/api/chapters/${fresh}`, { base_revision: 1, title: "Fresh", body: "new text", summary: "fresh sum 2" });
ok(r.status === 200, "edit with new summary ok");
// Title only.
r = await call("PATCH", `/api/chapters/${withSummary}`, { base_revision: 1, title: "Renamed", body: "Has summary body", summary: "has sum" });
ok(r.status === 200, "title-only edit ok");

list = await issues();
ok(of(list, stale).length === 1 && of(list, stale)[0].kind === "summary-stale", "body edit with the same summary is summary-stale");
ok(of(list, fresh).length === 0, "body edit with a new summary has no issue");
ok(of(list, withSummary).length === 0, "title-only edit has no issue");
ok(list.length === 2, "only the two expected issues: " + list.length);
const depths = list.map((i) => i.depth);
ok(depths.every((d, i) => i === 0 || d >= depths[i - 1]), "issues are ordered parents before children");

r = await call("GET", "/api/stories/does-not-exist/review");
ok(r.status === 404 && r.json.error, "unknown story is a 404");

// ---- decisions: later, dismissed, undo, and an edit brings an issue back ----
ok(list.every((i) => i.status === "open" && i.fingerprint === ""), "issues start open with an empty fingerprint");
const decide = (id, body) => call("PUT", `/api/chapters/${id}/review`, body);
r = await decide(noSummary, { kind: "summary-missing", status: "later" });
ok(r.status === 200, "put off ok");
list = await issues();
ok(of(list, noSummary)[0].status === "later", "put-off issue is still listed, as later");
r = await decide(stale, { kind: "summary-stale", status: "dismissed" });
list = await issues();
ok(of(list, stale)[0].status === "dismissed" && list.length === 2, "dismissed issue is listed as dismissed");
r = await decide(noSummary, { kind: "summary-missing", status: "open" });
list = await issues();
ok(of(list, noSummary)[0].status === "open", "open undoes a decision");
r = await call("PATCH", `/api/chapters/${stale}`, { base_revision: 2, title: "Stale", body: "newer text", summary: "stale sum" });
ok(r.status === 200, "second edit keeping the summary ok");
list = await issues();
ok(of(list, stale)[0].status === "open", "an edit after dismissing brings the issue back");
r = await decide(stale, { kind: "summary-stale", status: "dismissed" });
r = await decide(stale, { kind: "summary-stale", status: "later" });
list = await issues();
ok(of(list, stale)[0].status === "later", "a new decision replaces the old one");

r = await decide(noSummary, { kind: "nonsense", status: "later" });
ok(r.status === 400, "unknown kind is a 400");
r = await decide(noSummary, { kind: "summary-missing", status: "maybe" });
ok(r.status === 400, "unknown status is a 400");
r = await decide("does-not-exist", { kind: "summary-missing", status: "later" });
ok(r.status === 404, "unknown chapter is a 404");

// ---- continuity: verdicts the AI made, kept by fingerprint; a contradiction becomes an issue on the later chapter ----
const side = (chapterId, revision, value, quote) => ({ chapterId, revision, value, quote });
const clash = (verdict, before, after, extra = {}) => ({ verdict, entity: "Mira", attribute: "eye colour", before, after, ...extra });
const continuityOf = (l) => l.filter((i) => i.kind === "continuity");
ok(continuityOf(await issues()).length === 0, "no continuity issue before any verdict");
r = await call("GET", `/api/stories/${story}/continuity`);
ok(r.status === 200 && r.json.verdicts.length === 0, "a story starts with no verdicts");
r = await call("GET", "/api/stories/does-not-exist/continuity");
ok(r.status === 404, "verdicts of an unknown story are a 404");

const rev = async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter.revision;
const revWith = await rev(withSummary);
const revFresh = await rev(fresh);
r = await call("POST", `/api/stories/${story}/continuity`, clash("contradiction", side(withSummary, revWith, "green", "her green eyes"), side(fresh, revFresh, "blue", "her blue eyes")));
ok(r.status === 200 && /^[0-9a-f]{16}$/.test(r.json.fingerprint), "a verdict is saved and answers its fingerprint");
const fp = r.json.fingerprint;
list = continuityOf(await issues());
ok(list.length === 1 && list[0].chapterId === fresh && list[0].fingerprint === fp && list[0].status === "open", "a contradiction is an open issue on the later chapter");
ok(list[0].continuity.before.chapterId === withSummary && list[0].continuity.after.chapterId === fresh && list[0].continuity.before.quote === "her green eyes" && list[0].continuity.after.value === "blue", "…carrying both sides");
ok(list[0].continuity.before.title === "Renamed" && list[0].continuity.after.title === "Fresh", "…and both chapter titles");

r = await call("POST", `/api/stories/${story}/continuity`, clash("contradiction", side(withSummary, revWith, "green", "her green eyes"), side(fresh, revFresh, "blue", "her blue eyes")));
ok(r.json.fingerprint === fp && (await call("GET", `/api/stories/${story}/continuity`)).json.verdicts.length === 1, "the same two quotes replace the verdict instead of adding one");

r = await call("POST", `/api/stories/${story}/continuity`, clash("fine", side(withSummary, revWith, "tall", "she was tall"), side(fresh, revFresh, "small", "a small voice"), { attribute: "size" }));
ok(r.status === 200, "a fine verdict is saved");
r = await call("POST", `/api/stories/${story}/continuity`, clash("change", side(withSummary, revWith, "red", "a red coat"), side(fresh, revFresh, "grey", "a grey coat"), { attribute: "coat" }));
ok(r.status === 200 && continuityOf(await issues()).length === 1, "a fine verdict and a change make no issue");

r = await call("POST", `/api/stories/${story}/continuity`, clash("maybe", side(withSummary, revWith, "a", "q1"), side(fresh, revFresh, "b", "q2")));
ok(r.status === 400, "an unknown verdict is a 400");
r = await call("POST", `/api/stories/${story}/continuity`, clash("fine", side("nope", 1, "a", "q1"), side(fresh, revFresh, "b", "q2")));
ok(r.status === 404, "a chapter that is not in the story is a 404");
r = await call("POST", "/api/stories/does-not-exist/continuity", clash("fine", side(withSummary, 1, "a", "q1"), side(fresh, 1, "b", "q2")));
ok(r.status === 404, "a verdict on an unknown story is a 404");

// A second contradiction on the same later chapter stays apart by fingerprint.
r = await call("POST", `/api/stories/${story}/continuity`, clash("contradiction", side(noSummary, await rev(noSummary), "north", "the house in the north"), side(fresh, revFresh, "south", "the house in the south"), { entity: "House", attribute: "place" }));
const fp2 = r.json.fingerprint;
list = continuityOf(await issues());
ok(list.length === 2 && fp2 !== fp && list.every((i) => i.chapterId === fresh), "two contradictions on one chapter are two issues");

// Decisions work as for the other kinds, per fingerprint.
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "dismissed" });
ok(r.status === 200, "a continuity issue can be dismissed");
list = continuityOf(await issues());
ok(list.find((i) => i.fingerprint === fp).status === "dismissed" && list.find((i) => i.fingerprint === fp2).status === "open", "…only that one");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "later" });
ok(continuityOf(await issues()).find((i) => i.fingerprint === fp).status === "later", "…or put off");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "dismissed" });

// Intentional: a note is required, only continuity issues take it, and it is kept with the decision.
const codexAt = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json;
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "intentional" });
ok(r.status === 400, "intentional without a note is refused");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "intentional", note: "   " });
ok(r.status === 400, "…as is a blank note");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "intentional", note: "x".repeat(201) });
ok(r.status === 400, "…and one over 200 characters");
r = await decide(noSummary, { kind: "summary-missing", fingerprint: "", status: "intentional", note: "on purpose" });
ok(r.status === 400, "a summary issue can't be marked intentional");
ok(continuityOf(await issues()).find((i) => i.fingerprint === fp).intentionalNote === undefined, "…and nothing was saved");

// No codex entry named House: only the decision is kept.
const opsBefore = (await codexAt(fresh)).ops.length;
r = await decide(fresh, { kind: "continuity", fingerprint: fp2, status: "intentional", note: "  the house moved  " });
ok(r.status === 200 && r.json.codex_entry === null, "intentional with no matching codex entry saves the decision only");
ok((await codexAt(fresh)).ops.length === opsBefore, "…and writes no codex op");
list = continuityOf(await issues());
const house = list.find((i) => i.fingerprint === fp2);
ok(house.status === "dismissed" && house.intentionalNote === "the house moved", "…the issue is hidden from the open list and carries its trimmed note");
ok(list.find((i) => i.fingerprint === fp).intentionalNote === undefined, "…a plainly dismissed one has no note");

// An entry named like the entity (any case) gets the note as a replace op anchored at the later chapter.
r = await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "MIRA", type: "character", aliases: ["the thief"], content: "A thief.", always_include: true });
const miraEntry = r.json.entry_id;
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "intentional", note: "a disguise" });
ok(r.status === 200 && r.json.codex_entry === "MIRA", "intentional with a matching entry reports it");
let cx = await codexAt(fresh);
const written = cx.ops.filter((o) => o.entry_id === miraEntry && o.op === "replace");
ok(written.length === 1 && written[0].anchor_chapter_id === fresh && written[0].content === "A thief.\n\nIntentional (eye colour): a disguise", "…as a replace op at the chapter with the note appended");
ok(cx.entries[0].name === "MIRA" && cx.entries[0].aliases[0] === "the thief" && cx.entries[0].always_include === true && cx.entries[0].type === "character", "…keeping the entry's other fields");
ok((await codexAt(root)).entries[0].content === "A thief.", "…and the earlier chapters' codex is unchanged");
list = continuityOf(await issues());
ok(list.find((i) => i.fingerprint === fp).status === "dismissed" && list.find((i) => i.fingerprint === fp).intentionalNote === "a disguise", "the decision is saved with its note");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "open" });
ok(continuityOf(await issues()).find((i) => i.fingerprint === fp).status === "open", "undo brings an intentional issue back");
r = await decide(fresh, { kind: "continuity", fingerprint: fp, status: "dismissed" });
ok(continuityOf(await issues()).find((i) => i.fingerprint === fp).intentionalNote === undefined, "dismissing it again drops the note");

// An edit to either chapter makes the verdict stale: the issue is gone.
r = await call("PATCH", `/api/chapters/${noSummary}`, { base_revision: await rev(noSummary), title: "No summary", body: "edited", summary: "now has one" });
ok(r.status === 200, "the earlier chapter can be edited");
list = continuityOf(await issues());
ok(list.length === 1 && list[0].fingerprint === fp, "editing the earlier chapter hides that issue");
r = await call("PATCH", `/api/chapters/${fresh}`, { base_revision: revFresh, title: "Fresh", body: "edited again", summary: "fresh sum 3" });
ok(r.status === 200 && continuityOf(await issues()).length === 0, "editing the later chapter hides the other");
const kept = (await call("GET", `/api/stories/${story}/continuity`)).json.verdicts;
ok(kept.length === 4, "…the verdicts themselves are kept");
