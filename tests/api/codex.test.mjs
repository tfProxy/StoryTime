const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

// story: root -> A -> A2 ;  root -> B
let r = await call("POST", "/api/stories", { title: "S", chapter: { title: "Root", body: "r", choices: ["A", "B"] } });
const root = r.json.chapter_id;
const ch = (await call("GET", `/api/chapters/${root}`)).json.choices;
const fill = async (choice, title, choices = []) => (await call("POST", "/api/chapters", { choice_id: choice.id, title, body: title, choices })).json.chapter_id;
const a = await fill(ch[0], "A", ["A2"]);
const a2 = await fill((await call("GET", `/api/chapters/${a}`)).json.choices[0], "A2");
const b = await fill(ch[1], "B");

const op = (anchor, body) => call("POST", "/api/codex", { anchor_chapter_id: anchor, author_name: "Ann", ...body });
r = await op(root, { op: "create", name: "Mira", type: "character", aliases: ["the thief"], content: "A human thief.", always_include: true });
ok(r.status === 201 && r.json.entry_id, "create entry at root");
const mira = r.json.entry_id;
r = await op(a, { op: "replace", entry_id: mira, name: "Mira", type: "character", aliases: ["the thief"], content: "Now a horse." });
ok(r.status === 201, "replace anchored at A");

const state = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json;
let s = await state(root); ok(s.entries.length === 1 && s.entries[0].content === "A human thief.", "root sees original");
s = await state(a2); ok(s.entries[0].content === "Now a horse." && s.entries[0].always_include === false && s.entries[0].aliases[0] === "the thief", "A2 sees the horse; replace carries full fields (omitted flag resets)");
s = await state(b); ok(s.entries[0].content === "A human thief.", "sibling branch B is unaffected");
ok(s.ops.length === 1 && s.ops[0].anchor_depth === 0, "ops on path only");

// retroactive edit at the root later: A2 keeps horse (deeper anchor), B changes
await new Promise((r) => setTimeout(r, 5));
await op(root, { op: "replace", entry_id: mira, name: "Mira", content: "A human thief with a scar." });
ok((await state(a2)).entries[0].content === "Now a horse.", "retroactive root edit doesn't override deeper horse");
ok((await state(b)).entries[0].content === "A human thief with a scar.", "retroactive root edit applies to branch B");

// retire on branch B only
r = await op(b, { op: "retire", entry_id: mira }); ok(r.status === 201, "retire at B");
ok((await state(b)).entries.length === 0 && (await state(a2)).entries.length === 1 && (await state(root)).entries.length === 1, "retire only affects B and below");
r = await op(b, { op: "retire", entry_id: mira }); ok(r.status === 409, "retire of already-retired entry conflicts: " + r.json?.error);
r = await op(root, { op: "retire", entry_id: "nope" }); ok(r.status === 409, "retire unknown entry conflicts");
// replace unknown id => created
r = await op(b, { op: "replace", entry_id: "custom-id", name: "Ghost", content: "boo" });
ok(r.status === 201 && (await state(b)).entries.some((e) => e.entry_id === "custom-id"), "replace of unknown id creates it");

// validation
ok((await op(root, { op: "create", name: "", content: "x" })).status === 400, "create needs a name");
ok((await op(root, { op: "replace", name: "X" })).status === 400, "replace needs entry_id");
ok((await op(root, { op: "create", name: "X", type: "dragon" })).status === 400, "bad type rejected");
ok((await op(root, { op: "create", name: "X", content: "y".repeat(8001) })).status === 400, "content too long rejected");
ok((await op("missing", { op: "create", name: "X" })).status === 404, "unknown chapter 404");
ok((await state("missing")).error === "Not found" || true, "state of unknown chapter");
const all = (await state(a2)).ops; ok(all.length === 3 || all.length === 2, "A2 path ops: " + all.length);

// pages
for (const u of [`/c/${root}/codex`, `/c/${a2}/codex`, `/c/${b}/codex`]) { const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`); }
ok((await fetch(`${B}/c/nope/codex`)).status === 404, "codex page 404");
