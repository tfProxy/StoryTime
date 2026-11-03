// Changing a codex entry's form: POST /api/codex/form names the old form, moves the chosen every-form facts to it and
// sets the new form and its facts, all or nothing.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

// root -> A -> A2 ; the entry starts at A
let r = await call("POST", "/api/stories", { title: "Forms", chapter: { title: "Root", body: "r", choices: ["A"] } });
const root = r.json.chapter_id;
const fill = async (from, title, choices = []) => (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${from}`)).json.choices[0].id, title, body: title, choices })).json.chapter_id;
const a = await fill(root, "A", ["A2"]);
const a2 = await fill(a, "A2");
const rowan = (await call("POST", "/api/codex", { anchor_chapter_id: a, op: "create", name: "Rowan", type: "character" })).json.entry_id;
const fact = async (anchor, aspect, text, form = "") => (await call("POST", "/api/codex/facts", { anchor_chapter_id: anchor, entry_id: rowan, op: "set", aspect, form, text })).json.fact_id;
const ears = await fact(a, "Ears", "Round human ears.");
await fact(a, "Personality", "Stubborn.");
const hair = await fact(a2, "Hair", "Long red hair.");
const at = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json.entries.find((e) => e.entry_id === rowan);

const change = (body) => call("POST", "/api/codex/form", { chapter_id: a2, entry_id: rowan, ...body });

r = await change({ form: { name: "vixen", anchor_chapter_id: a2 }, move: [ears] });
ok(r.status === 400, "moving facts needs a form to move them to: " + r.json?.error);
ok((await at(a2)).form === null, "…and nothing is saved");
r = await change({ add: [{ aspect: "Ears", text: "Fox ears." }] });
ok(r.status === 400, "facts of a new form need the form");
r = await change({ base_form: "human", form: { name: "vixen", anchor_chapter_id: a2 }, move: ["nope"] });
ok(r.status === 409, "a fact that isn't an every-form fact here is refused");
let e = await at(a2);
ok(e.form === null && e.baseForm === null, "…and the old form isn't saved either (all or nothing)");
ok((await call("POST", "/api/codex/form", { chapter_id: "nope", entry_id: rowan })).status === 404, "an unknown chapter is 404");

r = await change({
  base_form: "human",
  form: { name: "vixen", stage: "change complete", anchor_chapter_id: a2 },
  move: [ears, hair],
  add: [{ aspect: "Ears", text: "Tall fox ears." }],
});
ok(r.status === 201 && r.json.moved === 2, "a form change with moves is saved: " + JSON.stringify(r.json));
e = await at(a2);
ok(e.form?.name === "vixen" && e.baseForm === "human", "the new form is current and the old one is the normal form");
ok(e.description.startsWith("Form: vixen, change complete.") && e.description.includes("Tall fox ears.") && e.description.includes("Stubborn."), "the AI reads the new form, its facts and the every-form ones: " + e.description);
ok(!e.description.includes("Round human ears.") && !e.description.includes("Long red hair."), "…not the facts moved to the old form");
ok(e.facts.find((f) => f.fact_id === ears)?.form === "human" && e.facts.find((f) => f.fact_id === hair)?.form === "human", "the moved facts belong to the old form");

e = await at(a);
ok(e.form?.name === "human" && e.baseForm === "human", "the old form is set from where the entry starts");
ok(e.facts.find((f) => f.fact_id === ears)?.form === "human", "a moved fact is the old form's from where it was set");
ok(e.description.includes("Round human ears.") && e.description.includes("Stubborn.") && !e.description.includes("Form:"), "before the change the AI reads the old form's facts, without a Form line: " + e.description);

// Changing back: the old form is now known, so no base form is needed; a moved fact can't move twice.
r = await change({ form: { name: "human", anchor_chapter_id: a2 }, move: [ears] });
ok(r.status === 409, "a fact that already belongs to a form can't be moved again");
const pers = (await at(a2)).facts.find((f) => f.aspect === "Personality").fact_id;
r = await change({ form: { name: "Vixen", anchor_chapter_id: a2 }, move: [pers] });
ok(r.status === 400, "facts can't move to the form being set");
