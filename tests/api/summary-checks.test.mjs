// Summary checks: POST /api/chapters/:id/summary-check keeps the AI's verdict on a summary; a wrong one shows as a
// summary-wrong issue while the chapter and its summary are as checked, and goes when either changes.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const s = await call("POST", "/api/stories", { title: "Summary checks", chapter: { title: "Root", body: "root text", summary: "root sum", choices: ["A", "B"] } });
const story = s.json.story_id;
const root = s.json.chapter_id;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "child text", summary: "child sum" })).json.chapter_id;
const wrongs = async () => (await call("GET", `/api/stories/${story}/review`)).json.issues.filter((i) => i.kind === "summary-wrong");
const check = (id, body) => call("POST", `/api/chapters/${id}/summary-check`, body);

ok((await wrongs()).length === 0, "no summary-wrong issue to start with");

let r = await check(root, { revision: 1, summary: "root sum", verdict: "ok" });
ok(r.status === 200 && (await wrongs()).length === 0, "an ok check is saved and makes no issue");

r = await check(root, { revision: 1, summary: "root sum", verdict: "wrong", problem: "  Leaves out the fire.  " });
ok(r.status === 200, "a wrong check is saved");
let list = await wrongs();
ok(list.length === 1 && list[0].chapterId === root && list[0].fingerprint === "" && list[0].status === "open", "…it shows as an open summary-wrong issue on the chapter");
ok(list[0].message === "The summary doesn't match the chapter: Leaves out the fire.", "…with the problem trimmed into the message");

// Later / dismissed work like the other summary issues.
r = await call("PUT", `/api/chapters/${root}/review`, { kind: "summary-wrong", status: "later" });
ok(r.status === 200 && (await wrongs())[0].status === "later", "the issue can be put off");
r = await call("PUT", `/api/chapters/${root}/review`, { kind: "summary-wrong", status: "dismissed" });
ok(r.status === 200 && (await wrongs())[0].status === "dismissed", "…and dismissed");
r = await call("PUT", `/api/chapters/${root}/review`, { kind: "summary-wrong", status: "open" });
ok((await wrongs())[0].status === "open", "…and brought back");

// Checking again replaces the earlier check.
await check(root, { revision: 1, summary: "root sum", verdict: "ok" });
ok((await wrongs()).length === 0, "a later ok check replaces the wrong one");
await check(root, { revision: 1, summary: "root sum", verdict: "wrong", problem: "Adds a dragon." });

// Refused.
r = await check(root, { revision: 1, summary: "root sum", verdict: "wrong" });
ok(r.status === 400, "a wrong check needs a problem");
r = await check(root, { revision: 1, summary: "root sum", verdict: "wrong", problem: "   " });
ok(r.status === 400, "…not a blank one");
r = await check(root, { revision: 1, summary: "root sum", verdict: "wrong", problem: "x".repeat(201) });
ok(r.status === 400, "…nor one over 200 characters");
r = await check(root, { revision: 1, summary: "root sum", verdict: "maybe" });
ok(r.status === 400, "an unknown verdict is refused");
r = await check("nope", { revision: 1, summary: "x", verdict: "ok" });
ok(r.status === 404, "a chapter that does not exist is 404");
r = await check(child, { revision: 2, summary: "child sum", verdict: "wrong", problem: "Old." });
ok(r.status === 409, "a check of a revision the chapter is not at is refused (409)");
r = await check(child, { revision: 1, summary: "another sum", verdict: "wrong", problem: "Old." });
ok(r.status === 409, "…and so is one of a summary the chapter no longer has");
ok((await wrongs()).length === 1, "…nothing was saved");

// A summary edit (the revision stays) makes the check stale.
r = await call("PUT", `/api/chapters/${root}/summary`, { revision: 1, summary: "root sum, fixed", path_summary: "root path" });
ok(r.status === 200, "the summary is fixed");
ok((await wrongs()).length === 0, "…and the issue goes");
r = await check(root, { revision: 1, summary: "root sum", verdict: "wrong", problem: "Old." });
ok(r.status === 409, "…a check of the old summary can no longer be saved");
r = await check(root, { revision: 1, summary: "root sum, fixed", verdict: "wrong", problem: "Still off." });
ok(r.status === 200 && (await wrongs()).length === 1, "…a check of the new one can");

// A chapter edit (the revision changes) makes the check stale too.
r = await call("PATCH", `/api/chapters/${root}`, { base_revision: 1, title: "Root", body: "root text, edited", summary: "root sum, fixed" });
ok(r.status === 200 && (await wrongs()).length === 0, "editing the chapter text makes the check stale");
