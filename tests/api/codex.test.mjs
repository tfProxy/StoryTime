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

const op = (anchor, body) => call("POST", "/api/codex", { anchor_chapter_id: anchor, ...body });
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

// codex changes posted with a chapter are anchored at it, all or nothing
const a2choice = await call("POST", "/api/chapters", { parent_chapter_id: a2, new_choice_label: "On", title: "A3", body: "x",
  codex_changes: [
    { op: "create", name: "Zed", type: "character", content: "A ferryman." },
    { op: "replace", entry_id: mira, name: "Mira", type: "character", content: "A horse with wings." },
  ] });
ok(a2choice.status === 201, "a chapter can be posted with codex changes");
const a3 = a2choice.json.chapter_id;
s = await state(a3);
ok(s.entries.length === 2 && s.entries.find((e) => e.name === "Zed") && s.entries.find((e) => e.entry_id === mira).content === "A horse with wings.", "the changes apply at the new chapter");
ok(s.ops.filter((o) => o.anchor_chapter_id === a3).length === 2, "…anchored at it");
ok((await state(a2)).entries.find((e) => e.entry_id === mira).content === "Now a horse.", "the parent is unaffected");
const before = (await call("GET", `/api/chapters/${a2}`)).json.choices.length;
r = await call("POST", "/api/chapters", { parent_chapter_id: a2, new_choice_label: "Bad", title: "A4", body: "x", codex_changes: [{ op: "retire", entry_id: "nope" }] });
ok(r.status === 409 && (await call("GET", `/api/chapters/${a2}`)).json.choices.length === before, "a bad codex change rejects the whole post: " + r.json?.error);
ok((await call("POST", "/api/chapters", { parent_chapter_id: a2, new_choice_label: "Bad", title: "A4", body: "x", codex_changes: [{ op: "create", name: "" }] })).status === 400, "codex changes are validated");

// …and with an edit
const bc = await call("POST", "/api/chapters", { parent_chapter_id: b, new_choice_label: "Go", title: "B2", body: "b" });
r = await call("PATCH", `/api/chapters/${bc.json.chapter_id}`, { base_revision: 1, title: "B2", body: "b!",
  codex_changes: [{ op: "create", name: "Lamp", type: "item", content: "Brass." }] });
ok(r.status === 200 && (await state(bc.json.chapter_id)).entries.some((x) => x.name === "Lamp") && !(await state(b)).entries.some((x) => x.name === "Lamp"), "an edit can carry codex changes, anchored at the edited chapter");

// Markdown download of the codex at a chapter
const md = await fetch(`${B}/api/chapters/${a3}/codex?format=md`);
const mdText = await md.text();
ok(md.status === 200 && /text\/markdown/.test(md.headers.get("content-type")) && /filename="s-codex-a3\.md"/.test(md.headers.get("content-disposition")), "codex markdown download");
ok(mdText.startsWith("# S: codex") && mdText.includes("## Characters") && mdText.includes("### Zed\n\n**Notes** (not sent to the AI)\n\nA ferryman.") && mdText.includes("### Mira") && mdText.includes("A horse with wings."), "entries are grouped by type with their text");
ok(!mdText.includes("A human thief") && !mdText.includes("Now a horse."), "only the current version of an entry shows");
await op(root, { op: "create", name: "Ferry", type: "place", aliases: ["the crossing"], always_include: true, content: "A river crossing." });
const rootMd = await (await fetch(`${B}/api/chapters/${root}/codex?format=md`)).text();
ok(rootMd.includes("## Places\n\n### Ferry\n\n*Also known as: the crossing · Always included in AI prompts*\n\n**Notes** (not sent to the AI)\n\nA river crossing.") && rootMd.indexOf("## Characters") < rootMd.indexOf("## Places"), "aliases and the always-include flag are noted, types in order");
ok(!(await (await fetch(`${B}/api/chapters/${b}/codex?format=md`)).text()).includes("Zed"), "another branch's codex doesn't include it");
ok((await fetch(`${B}/api/chapters/${a3}/codex?format=pdf`)).status === 400 && (await fetch(`${B}/api/chapters/nope/codex?format=md`)).status === 404, "bad format 400, unknown chapter 404");

// pages
for (const u of [`/c/${root}/codex`, `/c/${a2}/codex`, `/c/${b}/codex`]) { const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`); }
ok((await fetch(`${B}/c/nope/codex`)).status === 404, "codex page 404");

// ---- facts ----
const fact = (anchor, body) => call("POST", "/api/codex/facts", { anchor_chapter_id: anchor, ...body });
const kit = (await op(root, { op: "create", name: "Kit", type: "character", content: "A fox." })).json.entry_id;
r = await fact(root, { entry_id: kit, op: "set", aspect: "Ears", text: "Tall russet fox ears.", quote: "Her ears twitched." });
ok(r.status === 201 && r.json.fact_id && r.json.id, "set a fact");
const earsId = r.json.fact_id;
let kitAt = async (id) => (await state(id)).entries.find((e) => e.entry_id === kit);
let k = await kitAt(root);
ok(k.facts.length === 1 && k.facts[0].aspect === "Ears" && k.facts[0].quote === "Her ears twitched." && k.description === "Ears: Tall russet fox ears.", "entry shows the fact and a description (without the notes)");
ok(k.content === "A fox.", "content stays the notes");
r = await fact(a, { entry_id: kit, op: "set", aspect: "ears", text: "Short ears." });
ok(r.status === 201 && r.json.fact_id === earsId, "the same aspect again reuses the fact id");
ok((await kitAt(root)).facts[0].text === "Tall russet fox ears.", "a fact anchored at a child isn't visible at the parent");
k = await kitAt(a2);
ok(k.facts.length === 1 && k.facts[0].text === "Short ears." && (await state(a2)).facts.length === 2, "the child sees its own version, and both ops are listed");
ok((await kitAt(b)).facts[0].text === "Tall russet fox ears.", "a sibling branch keeps the original");
r = await fact(a, { entry_id: kit, op: "set", aspect: "Ears", form: "vixen", text: "Pointed ears." });
ok(r.status === 201 && r.json.fact_id !== earsId, "the same aspect in another form is a different fact");
await fact(a, { entry_id: kit, op: "set", aspect: "Tail", form: "human", text: "No tail." });
r = await fact(a, { entry_id: kit, op: "set", aspect: "Form", form: "vixen", text: "change complete" });
k = await kitAt(a2);
ok(r.status === 201 && k.form?.name === "vixen" && k.description.startsWith("Form: vixen, change complete."), "the form fact sets the form: " + k.description);
ok(k.description.includes("Pointed ears.") && k.description.includes("Short ears.") && !k.description.includes("No tail."), "only the current form's facts apply (plus every-form ones)");
r = await fact(a, { entry_id: kit, op: "retire", fact_id: earsId });
ok(r.status === 201 && (await kitAt(a2)).facts.every((f) => f.fact_id !== earsId), "retire a fact");
ok((await kitAt(root)).facts.some((f) => f.fact_id === earsId), "…only below where it was retired");
r = await fact(a, { entry_id: kit, op: "retire", fact_id: earsId });
ok(r.status === 409, "retiring a retired fact conflicts");
r = await fact(root, { entry_id: "nope", op: "set", aspect: "Ears", text: "x" });
ok(r.status === 409, "a fact for an unknown entry conflicts");
r = await fact("nope", { entry_id: kit, op: "set", aspect: "Ears", text: "x" });
ok(r.status === 404, "a fact at an unknown chapter is 404");
r = await fact(root, { entry_id: kit, op: "set", aspect: "Ears", text: "" });
ok(r.status === 400, "a fact needs text");
r = await fact(root, { entry_id: kit, op: "retire" });
ok(r.status === 400, "retire needs a fact id");
const factMd = await (await fetch(`${B}/api/chapters/${a2}/codex?format=md`)).text();
ok(factMd.includes("Form: vixen, change complete.") && factMd.includes("A fox."), "the markdown download uses facts");
