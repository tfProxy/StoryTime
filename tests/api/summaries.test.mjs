// Summary storage: posted with a chapter, fill-only afterwards, cleared below an edited chapter.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const KEY = "summary-test-key-0123456789";

// A chapter posted with summaries keeps them.
let r = await call("POST", "/api/stories", { title: "S", chapter: { title: "Root", body: "root", summary: "root sum", path_summary: "root path", edit_key: KEY, choices: ["Go"] } });
const root = r.json.chapter_id;
let g = await call("GET", `/api/chapters/${root}`);
ok(g.json.chapter.summary === "root sum" && g.json.chapter.path_summary === "root path", "summaries posted with a chapter are stored and returned");

// A chapter posted without them has none.
r = await call("POST", "/api/chapters", { choice_id: g.json.choices[0].id, title: "Two", body: "two", choices: ["More"] });
const two = r.json.chapter_id;
g = await call("GET", `/api/chapters/${two}`);
ok(g.json.chapter.summary === null && g.json.chapter.path_summary === null, "no summary when none was posted");
const more = g.json.choices[0];
r = await call("POST", "/api/chapters", { choice_id: more.id, title: "Three", body: "three" });
const three = r.json.chapter_id;

// Fill-only.
r = await call("POST", `/api/chapters/${two}/summary`, { revision: 1, summary: "two sum", path_summary: "two path" });
ok(r.status === 200 && r.json.summary_set && r.json.path_summary_set, "missing summaries can be filled");
g = await call("GET", `/api/chapters/${two}`);
ok(g.json.chapter.summary === "two sum" && g.json.chapter.path_summary === "two path", "filled values are stored");
r = await call("POST", `/api/chapters/${two}/summary`, { revision: 1, summary: "HIJACK", path_summary: "HIJACK" });
ok(r.status === 200 && !r.json.summary_set && !r.json.path_summary_set, "existing summaries are never overwritten");
g = await call("GET", `/api/chapters/${two}`);
ok(g.json.chapter.summary === "two sum", "…and the original stays");
r = await call("POST", `/api/chapters/${three}/summary`, { revision: 1, path_summary: "three path only" });
ok(r.json.path_summary_set === true && r.json.summary_set === false, "each field is filled independently");

// Validation.
ok((await call("POST", `/api/chapters/${two}/summary`, { revision: 2, summary: "x" })).status === 409, "wrong revision conflicts");
ok((await call("POST", `/api/chapters/nope/summary`, { revision: 1, summary: "x" })).status === 404, "unknown chapter 404");
ok((await call("POST", `/api/chapters/${two}/summary`, { summary: "x" })).status === 400, "revision is required");
ok((await call("POST", `/api/chapters/${two}/summary`, { revision: 1, summary: "x".repeat(5001) })).status === 400, "over-long summary rejected");

// Editing a chapter replaces its own summaries and clears the ones below it.
r = await call("PATCH", `/api/chapters/${root}`, { edit_key: KEY, base_revision: 1, title: "Root v2", body: "root v2", summary: "new root sum", path_summary: "new root path" });
ok(r.status === 200, "edit with fresh summaries");
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.chapter.summary === "new root sum" && g.json.chapter.path_summary === "new root path", "the edited chapter takes the summaries sent with the edit");
const below = [two, three].map(async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter);
const [t2, t3] = await Promise.all(below);
ok(t2.path_summary === null && t3.path_summary === null, "summaries below an edited chapter are cleared");
ok(t2.summary === "two sum", "…but each chapter keeps its own single-chapter summary");
// they can then be refilled against the current revision
r = await call("POST", `/api/chapters/${two}/summary`, { revision: 1, path_summary: "rebuilt" });
ok(r.json.path_summary_set === true, "cleared summaries can be rebuilt");

// An edit without summaries leaves the chapter's summaries empty (to be rebuilt lazily).
r = await call("PATCH", `/api/chapters/${root}`, { edit_key: KEY, base_revision: 2, title: "Root v3", body: "root v3" });
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.chapter.summary === null && g.json.chapter.path_summary === null, "an edit with no summaries clears the chapter's own");
