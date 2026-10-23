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
