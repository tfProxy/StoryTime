// Facts storage: POST /api/chapters/:id/facts replaces a chapter's facts for its current revision, and
// GET /api/chapters/:id/facts lists them along the path from the root.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const fact = (entity, attribute, value, quote = "some words") => ({ entity, attribute, value, quote });

const s = await call("POST", "/api/stories", { title: "Facts", chapter: { title: "Root", body: "root", summary: "s", choices: ["Go"] } });
const root = s.json.chapter_id;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "child", summary: "c" })).json.chapter_id;
const along = async (id) => (await call("GET", `/api/chapters/${id}/facts`)).json.path;

let r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: [fact("Ann", "eye colour", "green"), fact("Ann", "home", "the farm")] });
ok(r.status === 200 && r.json.saved === 2, "facts can be saved for a chapter");
r = await call("POST", `/api/chapters/${child}/facts`, { revision: 1, facts: [fact("Bob", "species", "fox")] });
ok(r.status === 200 && r.json.saved === 1, "…and for another");
let path = await along(child);
ok(path.length === 2 && path[0].chapterId === root && path[1].chapterId === child, "the facts come root first, then down to the chapter");
ok(path[0].facts.length === 2 && path[0].facts[0].attribute === "eye colour" && path[1].facts[0].entity === "Bob", "…each chapter with its own facts, in the order saved");
ok((await along(root)).length === 1, "…and a chapter alone gives only itself");

r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: [fact("Ann", "age", "9")] });
ok(r.status === 200 && (await along(root))[0].facts.length === 1 && (await along(root))[0].facts[0].attribute === "age", "saving again replaces the chapter's facts");
r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: [] });
ok(r.status === 200 && r.json.saved === 0 && (await along(root))[0].facts.length === 0, "an empty list is saved (the chapter was read and has no facts)");

r = await call("PATCH", `/api/chapters/${child}`, { title: "Child", body: "child, edited", base_revision: 1, codex_changes: [] });
ok(r.status === 200, "a chapter can be edited");
path = await along(child);
ok(path[1].facts.length === 0, "an edited chapter's facts no longer count");
r = await call("POST", `/api/chapters/${child}/facts`, { revision: 1, facts: [fact("Bob", "species", "wolf")] });
ok(r.status === 409, "facts read from an old revision are refused");
ok((await along(child))[1].facts.length === 0, "…and nothing is saved");
r = await call("POST", `/api/chapters/${child}/facts`, { revision: 2, facts: [fact("Bob", "species", "wolf")] });
ok(r.status === 200 && (await along(child))[1].facts[0].value === "wolf", "facts read from the current revision are saved");

r = await call("POST", "/api/chapters/nope/facts", { revision: 1, facts: [] });
ok(r.status === 404, "a chapter that does not exist is 404");
ok((await call("GET", "/api/chapters/nope/facts")).status === 404, "…also when listing");
r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: [{ entity: "Ann", attribute: "home" }] });
ok(r.status === 400, "a fact without a value or quote is refused");
r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: [fact("Ann", "home", "x".repeat(121))] });
ok(r.status === 400, "a value over 120 characters is refused");
r = await call("POST", `/api/chapters/${root}/facts`, { revision: 1, facts: Array.from({ length: 41 }, (_, i) => fact("Ann", `a${i}`, "v")) });
ok(r.status === 400, "more than 40 facts are refused");
r = await call("POST", `/api/chapters/${root}/facts`, { facts: [] });
ok(r.status === 400, "a revision is needed");
