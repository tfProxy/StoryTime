// Admin: login, removing / restoring / deleting content, reverting edits.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const PASSWORD = process.env.ADMIN_PASSWORD;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const json = { "Content-Type": "application/json" };
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(B + url, { method, headers: { ...json, ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
};

// ---- login ----
let r = await call("POST", "/api/admin/action", { action: "remove", kind: "chapter", id: "x" });
ok(r.status === 401, "admin actions need a session");
r = await call("POST", "/api/admin/login", { password: "wrong" });
ok(r.status === 401, "wrong password rejected");
r = await call("POST", "/api/admin/login", { password: PASSWORD });
ok(r.status === 200, "right password accepted");
const setCookie = r.headers.get("set-cookie") ?? "";
ok(/storytime_admin=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=strict/i.test(setCookie), "session cookie is HttpOnly and SameSite=Strict");
const cookie = setCookie.split(";")[0];
const admin = { Cookie: cookie };
const act = (action, kind, id) => call("POST", "/api/admin/action", { action, kind, id }, admin);

r = await call("POST", "/api/admin/action", { action: "remove", kind: "chapter", id: "x" }, { Cookie: "storytime_admin=123.forged" });
ok(r.status === 401, "a forged cookie is rejected");
r = await fetch(B + "/api/admin/action", { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" });
ok(r.status === 415, "non-JSON posts are refused even with a valid session");
const page = await (await fetch(B + "/admin")).text();
ok(page.includes("Admin password") && !page.includes("Remove"), "the admin page shows only a login form to visitors");
const adminPage = await (await fetch(B + "/admin", { headers: admin })).text();
ok(adminPage.includes("Sign out"), "the admin page shows tools to a signed-in admin");

// ---- a story to moderate ----
const api = (method, url, body) => call(method, url, body);
let s = await api("POST", "/api/stories", { title: "Mod story", author_name: "Ann", chapter: { title: "Root", body: "root text", edit_key: "root-key-0123456789abcdef", choices: ["A", "B"] } });
const root = s.json.chapter_id, story = s.json.story_id;
let g = await api("GET", `/api/chapters/${root}`);
const [cA, cB] = g.json.choices;
const mk = async (choice, title, extra = {}) => (await api("POST", "/api/chapters", { choice_id: choice.id, title, body: `${title} body`, ...extra })).json.chapter_id;
const A = await mk(cA, "Chapter A", { choices: ["A2"], edit_key: "a-key-0123456789abcdefgh" });
const A2 = await mk((await api("GET", `/api/chapters/${A}`)).json.choices[0], "Chapter A2");
const Bch = await mk(cB, "Chapter B");
const op = await api("POST", "/api/codex", { anchor_chapter_id: A, op: "create", name: "Mira", content: "bad entry" });
const opId = op.json.id;

// ---- remove a chapter: its subtree disappears, its slot reopens ----
r = await act("remove", "chapter", A);
ok(r.status === 200 && r.json.changed && r.json.hidden === 1, "remove chapter reports the chapters hidden below it");
ok((await api("GET", `/api/chapters/${A}`)).status === 404 && (await api("GET", `/api/chapters/${A2}`)).status === 404, "the chapter and its descendants are gone for readers");
ok((await fetch(`${B}/c/${A2}`)).status === 404, "descendant pages 404");
g = await api("GET", `/api/chapters/${root}`);
ok(g.json.choices[0].child_chapter_id === null && g.json.choices[1].child_chapter_id === Bch, "the removed chapter's choice is unwritten again; siblings untouched");
ok((await api("GET", `/api/chapters/${A}/codex`)).status === 404, "codex of a hidden chapter is hidden too");
ok((await act("remove", "chapter", A)).json.changed === false, "removing twice is harmless");
const refill = await api("POST", "/api/chapters", { choice_id: cA.id, title: "Replacement", body: "better" });
ok(refill.status === 201, "someone can write a replacement for the reopened slot");
r = await act("restore", "chapter", A);
ok(r.status === 409 && /different chapter/.test(r.json.error), "restoring is refused while the slot is refilled: " + r.json?.error);
await act("remove", "chapter", refill.json.chapter_id);
r = await act("restore", "chapter", A);
ok(r.status === 200 && r.json.changed, "restore works once the slot is free");
ok((await api("GET", `/api/chapters/${A2}`)).status === 200, "the descendants come back with it");
ok((await api("GET", `/api/chapters/${A}/codex`)).json.entries.some((e) => e.name === "Mira"), "…and so do its codex changes");
ok((await act("restore", "chapter", A)).json.changed === false, "restoring something that isn't removed is harmless");
ok((await act("remove", "chapter", "nope")).status === 409, "unknown id reports an error");

// ---- codex ops ----
r = await act("remove", "codex_op", opId);
ok(r.status === 200 && (await api("GET", `/api/chapters/${A2}/codex`)).json.entries.length === 0, "a removed codex change stops applying");
await act("restore", "codex_op", opId);
ok((await api("GET", `/api/chapters/${A2}/codex`)).json.entries.length === 1, "…and applies again when restored");

// ---- choices ----
const spare = await api("POST", "/api/chapters", { parent_chapter_id: root, new_choice_label: "Rude label", title: "Spare", body: "x" });
const spareChoice = (await api("GET", `/api/chapters/${root}`)).json.choices.find((c) => c.label === "Rude label");
r = await act("remove", "choice", spareChoice.id);
g = await api("GET", `/api/chapters/${root}`);
ok(!g.json.choices.some((c) => c.label === "Rude label") && (await api("GET", `/api/chapters/${spare.json.chapter_id}`)).status === 404, "removing a choice also removes the chapter written for it");
await act("restore", "choice", spareChoice.id);
ok((await api("GET", `/api/chapters/${root}`)).json.choices.some((c) => c.label === "Rude label"), "a removed choice can be restored");

// ---- stories ----
await act("remove", "story", story);
ok(!(await api("GET", "/api/stories")).json.some((x) => x.id === story) && (await fetch(`${B}/s/${story}`)).status === 404 && (await fetch(`${B}/c/${root}`)).status === 404, "a removed story disappears everywhere");
await act("restore", "story", story);
ok((await api("GET", "/api/stories")).json.some((x) => x.id === story), "a restored story is back");

// ---- reverting an edit ----
const edit = (n, body) => api("PATCH", `/api/chapters/${root}`, { edit_key: "root-key-0123456789abcdef", base_revision: n, title: `Root v${n + 1}`, body });
await edit(1, "vandalised once");
await edit(2, "vandalised twice");
r = await call("POST", "/api/admin/revert", { chapter_id: root, revision: 1 });
ok(r.status === 401, "revert needs a session");
r = await call("POST", "/api/admin/revert", { chapter_id: root, revision: 1 }, admin);
ok(r.status === 200 && r.json.revision === 4, "revert creates a new revision: " + JSON.stringify(r.json));
g = await api("GET", `/api/chapters/${root}`);
ok(g.json.chapter.body === "root text" && g.json.chapter.title === "Root" && g.json.chapter.edited_by === "admin", "the original text is back");
const revs = (await api("GET", `/api/chapters/${root}/revisions`)).json;
ok(revs.length === 3 && revs.some((v) => v.body === "vandalised twice"), "the reverted text stays in the history");
ok((await call("POST", "/api/admin/revert", { chapter_id: root, revision: 99 }, admin)).status === 409, "reverting to a missing revision is refused");

// ---- permanent deletion ----
r = await act("delete", "chapter", Bch);
ok(r.status === 409 && /Remove it first/.test(r.json.error), "can't delete what hasn't been removed");
await act("remove", "chapter", A);
r = await act("delete", "chapter", A);
ok(r.status === 200 && r.json.chapters === 2 && r.json.codexOps === 1, "delete removes the chapter, its subtree and its codex changes: " + JSON.stringify(r.json));
g = await api("GET", `/api/chapters/${root}`);
ok(g.json.choices[0].child_chapter_id === null, "the slot is open again after a permanent delete");
const list = await (await fetch(B + "/admin?removed=1", { headers: admin })).text();
ok(!list.includes("Chapter A2"), "deleted items are gone from the admin list");
await act("remove", "story", story);
r = await act("delete", "story", story);
ok(r.status === 200 && r.json.chapters >= 3, "a removed story can be deleted with everything in it: " + JSON.stringify(r.json));
ok((await act("restore", "story", story)).status === 409, "…and then it's really gone");
ok((await act("delete", "choice", "x")).status === 400, "only chapters and stories can be deleted permanently");

// ---- the admin page lists activity and filters ----
const s2 = await api("POST", "/api/stories", { title: "Filter story", author_name: "Zed", chapter: { title: "Findable chapter", body: "x" } });
let html = await (await fetch(B + "/admin", { headers: admin })).text();
ok(html.includes("Findable chapter") && html.includes("Filter story"), "recent activity lists new content");
await act("remove", "chapter", s2.json.chapter_id);
html = await (await fetch(B + "/admin?removed=1&kind=chapter", { headers: admin })).text();
ok(html.includes("Findable chapter") && html.includes("REMOVED"), "removed items show up (flagged) under 'removed only'");
html = await (await fetch(B + `/admin?story=${s2.json.story_id}&kind=story`, { headers: admin })).text();
ok(html.includes("Filter story") && !html.includes("Findable chapter"), "filters by kind and story");

// ---- logout ----
r = await call("POST", "/api/admin/logout", {}, admin);
ok(r.status === 200 && /storytime_admin=;|Max-Age=0|expires=/i.test(r.headers.get("set-cookie") ?? ""), "logout clears the cookie");
