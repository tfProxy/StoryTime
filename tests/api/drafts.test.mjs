// Drafts are stored on the server, and a save from a stale copy is refused instead of overwriting.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const key = "fill:abc123";
const url = `/api/drafts/${encodeURIComponent(key)}`;
const draft = (title, extra = {}) => ({ key, href: "/c/x/write?choice=abc123", label: "Story: “Go on”", title, body: "Text", storyTitle: "", ideaPages: [[{ choice: "Run", direction: "She runs" }]], ...extra });

let r = await call("GET", url);
ok(r.status === 404, "no draft until one is saved");

r = await call("PUT", url, { draft: draft("One"), base: null });
ok(r.status === 200 && typeof r.json.updatedAt === "number", "a new draft can be saved");
const first = r.json.updatedAt;

r = await call("GET", url);
ok(r.status === 200 && r.json.draft.title === "One" && r.json.draft.updatedAt === first && r.json.draft.key === key, "…and read back with its time");
ok(r.json.draft.ideaPages[0][0].choice === "Run", "…including the page's working state");

r = await call("PUT", url, { draft: draft("Two"), base: first });
ok(r.status === 200 && r.json.updatedAt > first, "saving over the version you have works, and moves the time on");
const second = r.json.updatedAt;

r = await call("PUT", url, { draft: draft("Stale"), base: first });
ok(r.status === 409 && r.json.current.title === "Two" && r.json.current.updatedAt === second, "saving from an older copy is refused, with the stored draft");
r = await call("PUT", url, { draft: draft("Also stale"), base: null });
ok(r.status === 409, "…as is starting a new draft where one already exists");
ok((await call("GET", url)).json.draft.title === "Two", "…and the stored draft is unchanged");

r = await call("GET", "/api/drafts");
const item = r.json.drafts.find((d) => d.key === key);
ok(item && item.title === "Two" && item.label === "Story: “Go on”" && item.updatedAt === second && item.body === undefined, "the list shows each draft without its text");

// moving a draft over from browser storage
r = await call("PUT", url, { draft: draft("Older local", { updatedAt: second - 1000 }), imported: true });
ok(r.status === 200 && r.json.kept === true && (await call("GET", url)).json.draft.title === "Two", "an older browser copy doesn't replace the stored draft");
r = await call("PUT", url, { draft: draft("Newer local", { updatedAt: second + 1000 }), imported: true });
ok(r.status === 200 && r.json.updatedAt === second + 1000 && (await call("GET", url)).json.draft.title === "Newer local", "a newer one does, keeping its own time");
r = await call("PUT", "/api/drafts/new%3Azzz", { draft: { ...draft("Fresh"), key: "new:zzz", updatedAt: 12345 }, imported: true });
ok(r.status === 200 && (await call("GET", "/api/drafts/new%3Azzz")).json.draft.updatedAt === 12345, "a browser draft with no stored copy is added as is");

ok((await call("PUT", url, { draft: "nope", base: null })).status === 400, "a draft must be an object");
ok((await call("PUT", url, { draft: { title: "x" }, base: null })).status === 400, "…with an href and a label");
ok((await call("PUT", url, { draft: draft("x"), base: "soon" })).status === 400, "base must be a number or null");
ok((await call("PUT", url, { draft: draft("x", { body: "x".repeat(8_100_000) }), base: null })).status === 413, "an oversized draft is refused");

r = await call("DELETE", url);
ok(r.status === 200 && (await call("GET", url)).status === 404, "a draft can be deleted");
r = await call("PUT", url, { draft: draft("Stale"), base: second });
ok(r.status === 409 && r.json.current === null, "saving a draft deleted elsewhere is refused, saying it's gone");
await call("DELETE", "/api/drafts/new%3Azzz");
