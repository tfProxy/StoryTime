// Moving a fact to an earlier chapter: GET/POST /api/codex/move-fact. The change that sets the fact is re-dated; it
// can't go before the entry's start, nor to or past another change of the same fact (or the same aspect) on the way.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

// root -> A -> B -> C -> D ; A -> A2
let r = await call("POST", "/api/stories", { title: "Moving facts", chapter: { title: "Root", body: "r", choices: ["A"] } });
const root = r.json.chapter_id;
const fill = async (from, title, choices = [], n = 0) => (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${from}`)).json.choices[n].id, title, body: title, choices })).json.chapter_id;
const a = await fill(root, "A", ["B", "A2"]);
const b = await fill(a, "B", ["C"]);
const c = await fill(b, "C", ["D"]);
const d = await fill(c, "D");
const a2 = await fill(a, "A2", [], 1);

const mira = (await call("POST", "/api/codex", { anchor_chapter_id: a, op: "create", name: "Mira", type: "character" })).json.entry_id;
const set = async (anchor, aspect, text, fact_id) => (await call("POST", "/api/codex/facts", { anchor_chapter_id: anchor, entry_id: mira, op: "set", aspect, text, ...(fact_id ? { fact_id } : {}) })).json;
const hair = await set(c, "Hair", "Red hair.");
const eyes = await set(b, "Eyes", "Green eyes.");
const eyes2 = await set(d, "Eyes", "Gold eyes.", eyes.fact_id);

const factAt = async (chapter, aspect) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.entry_id === mira)?.facts.find((f) => f.aspect === aspect);
const options = (op, chapter) => call("GET", `/api/codex/move-fact?entry_id=${mira}&fact_op_id=${op}&chapter_id=${chapter}`);
const move = (op, from, to) => call("POST", "/api/codex/move-fact", { entry_id: mira, fact_op_id: op, from_chapter_id: from, to_chapter_id: to });

// ---- what the dialog offers ----
r = await options(hair.id, d);
ok(r.status === 200 && r.json.chapter_id === c && r.json.number === 4 && r.json.label === "Hair: Red hair.", "the fact is set at C: " + JSON.stringify({ ...r.json, options: undefined }));
const opt = (id) => r.json.options.find((o) => o.chapter_id === id);
ok(r.json.options.map((o) => o.chapter_id).join() === [a, b, c].join(), "the line from where Mira first appears (A) to C is offered");
ok(opt(c).relation === "now" && !opt(c).allowed, "C is where it is now");
ok(opt(b).allowed && opt(b).gains === 0, "B is allowed, with no other branch gaining it");
ok(opt(a).allowed && opt(a).gains === 1, "A is allowed, and the A2 branch would gain it");

// ---- moving ----
ok((await factAt(b, "Hair")) === undefined, "before: Mira has no hair at B");
r = await move(hair.id, d, a);
ok(r.status === 200 && r.json.chapter_id === a, "the fact moves to A: " + JSON.stringify(r.json));
ok((await factAt(b, "Hair"))?.text === "Red hair." && (await factAt(a2, "Hair"))?.text === "Red hair." && (await factAt(d, "Hair"))?.text === "Red hair.", "it holds from A on, on both branches");
ok((await call("GET", `/api/chapters/${root}/codex`)).json.entries.every((e) => e.entry_id !== mira), "Root still has no Mira");

// ---- refusals ----
r = await options(eyes2.id, d);
const eo = (id) => r.json.options.find((o) => o.chapter_id === id);
ok(!eo(b).allowed && /set to “Green eyes\.” in “B”, so it can't move there/.test(eo(b).reason) && !eo(a).allowed && /before that/.test(eo(a).reason), "the later Eyes change can't move to or past the earlier one: " + eo(b).reason + " / " + eo(a).reason);
ok(eo(c).allowed, "…but can move to C, after it");
r = await move(eyes2.id, d, b);
ok(r.status === 409 && (await factAt(d, "Eyes"))?.text === "Gold eyes.", "a refused move changes nothing: " + r.json?.error);
const scar = await set(c, "Scar", "A scar on the cheek.");
await set(b, "Scar", "A burn scar.");
r = await options(scar.id, d);
ok(!r.json.options.find((o) => o.chapter_id === b).allowed, "another fact for the same aspect is in the way too");
r = await options(hair.id, d);
ok(r.json.options.map((o) => o.chapter_id).join() === [a, b, c, d].slice(0, 1).join() && r.json.options[0].relation === "now", "at the entry's first chapter there is nowhere earlier: " + JSON.stringify(r.json.options));
r = await move(hair.id, d, root);
ok(r.status === 409 && /first appears in “A”/.test(r.json?.error), "it can't move before the chapter where the entry first appears: " + r.json?.error);
r = await move(hair.id, a2, b);
ok(r.status === 400, "nor is a chapter that isn't on the line back from the fact: " + r.json?.error);
r = await options("nope", d);
ok(r.status === 404, "an unknown change is a 404");
r = await move(eyes.id, a2, a);
ok(r.status === 409, "a fact not set on the viewed branch can't be moved from there: " + r.json?.error);
