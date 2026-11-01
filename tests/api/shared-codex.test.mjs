const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

// Two stories: S1 root -> A -> A2 and root -> B;  S2 root.
const mk = async (title, choices = []) => {
  const r = await call("POST", "/api/stories", { title, chapter: { title: `${title} root`, body: "r", choices } });
  return r.json.chapter_id;
};
const fill = async (choice, title, choices = []) => (await call("POST", "/api/chapters", { choice_id: choice.id, title, body: title, choices })).json.chapter_id;
const root1 = await mk("Shared one", ["A", "B"]);
const ch = (await call("GET", `/api/chapters/${root1}`)).json.choices;
const a = await fill(ch[0], "A", ["A2"]);
const a2 = await fill((await call("GET", `/api/chapters/${a}`)).json.choices[0], "A2");
const b = await fill(ch[1], "B");
const root2 = await mk("Shared two");

const state = async (id) => (await call("GET", `/api/chapters/${id}/codex`)).json;
const find = (s, name) => s.entries.find((e) => e.name === name);

// The library
let r = await call("POST", "/api/shared", { name: "", type: "character" });
ok(r.status === 400, "a shared entry needs a name");
r = await call("POST", "/api/shared", { name: "Mara", type: "character", aliases: ["Mar"], content: "Base notes." });
ok(r.status === 201 && r.json.id, "create a shared entry");
const sid = r.json.id;
r = await call("POST", `/api/shared/${sid}/facts`, { aspect: "Ears", text: "Round ears." });
ok(r.status === 201 && r.json.id, "add a fact to it");
const earsId = r.json.id;
r = await call("POST", `/api/shared/${sid}/facts`, { aspect: "Eyes", text: "Green." });
const eyesId = r.json.id;
r = await call("POST", `/api/shared/${sid}/facts`, { aspect: "ears", text: "Tall ears." });
ok(r.json.id === earsId, "the same aspect again updates the fact");
await call("PUT", `/api/shared/${sid}/facts/${earsId}`, { aspect: "Ears", text: "Tall ears." });
ok((await call("POST", `/api/shared/${sid}/facts`, { aspect: "Hair", text: "" })).status === 400, "a fact needs text");
r = await call("GET", "/api/shared");
ok(r.json.entries.some((e) => e.id === sid && e.facts.length === 2), "the library lists it with its facts");

// Linking: from a chapter on, down that branch only
r = await call("POST", "/api/codex/link", { anchor_chapter_id: a, shared_entry_id: sid });
ok(r.status === 201 && r.json.entry_id, "link the entry at chapter A");
const mine = r.json.entry_id;
ok(!find(await state(root1), "Mara") && !find(await state(b), "Mara"), "it isn't there above the chapter or on another branch");
let s = await state(a2);
let e = find(s, "Mara");
ok(e && e.shared_entry_id === sid && e.content === "Base notes." && e.aliases.join() === "Mar", "it reads the base below the chapter");
ok(e.description === "Ears: Tall ears. Eyes: Green.", "…with the base's facts: " + e.description);
r = await call("POST", "/api/codex/link", { anchor_chapter_id: a2, shared_entry_id: sid });
ok(r.status === 409, "it can't be added twice: " + r.json?.error);
r = await call("POST", "/api/codex/link", { anchor_chapter_id: a, shared_entry_id: "nope" });
ok(r.status === 404, "an unknown shared entry is refused");
await call("POST", "/api/codex", { anchor_chapter_id: root2, op: "create", name: "mara", type: "character" });
r = await call("POST", "/api/codex/link", { anchor_chapter_id: root2, shared_entry_id: sid });
ok(r.status === 409, "a story that already has an entry of that name refuses it: " + r.json?.error);

// A second story links it too
const other = await mk("Shared three");
r = await call("POST", "/api/codex/link", { anchor_chapter_id: other, shared_entry_id: sid });
ok(r.status === 201, "another story links the same entry");

// Editing the base changes every story
r = await call("PATCH", `/api/shared/${sid}`, { name: "Mara Vale", content: "New base notes." });
ok(r.status === 200 && r.json.name === "Mara Vale", "edit the base");
e = find(await state(a2), "Mara Vale");
ok(e && e.content === "New base notes." && !find(await state(a2), "Mara"), "…the first story sees it");
ok(find(await state(other), "Mara Vale")?.content === "New base notes.", "…and so does the other");
ok((await call("PATCH", `/api/shared/${sid}`, {})).status === 400, "an empty change is refused");
ok(find(await state(a2), "Mara Vale").aliases.join() === "Mar" && find(await state(a2), "Mara Vale").type === "character", "a change to some fields leaves the others as they were");

// The story's own changes to the entry stay in the story
r = await call("POST", "/api/codex", { anchor_chapter_id: a2, op: "replace", entry_id: mine, name: "Mara Vale", type: "character", aliases: ["Mar"], content: "Changed here." });
ok(r.status === 409, "a plain replace of a linked entry is refused: " + r.json?.error);
e = find(await state(a2), "Mara Vale");
r = await call("POST", "/api/codex", { anchor_chapter_id: a2, op: "replace", entry_id: mine, name: e.name, type: e.type, aliases: e.aliases, content: e.content, always_include: e.always_include });
ok(r.status === 201, "a replace that repeats what it reads is fine");
// …facts too: the story changes a base fact for itself, hides one, or adds its own
r = await call("POST", "/api/codex/facts", { anchor_chapter_id: a2, entry_id: mine, op: "set", aspect: "Ears", text: "Fox ears." });
ok(r.status === 201 && r.json.fact_id === earsId, "setting a base fact's aspect in a story changes that fact");
e = find(await state(a2), "Mara Vale");
ok(e.description === "Ears: Fox ears. Eyes: Green.", "…for the story: " + e.description);
r = await call("POST", "/api/shared", { name: "Probe" });
r = await call("POST", "/api/codex/facts", { anchor_chapter_id: a2, entry_id: mine, op: "set", aspect: "Tail", text: "A fox tail." });
ok(r.status === 201, "a story can add a fact of its own");
r = await call("PUT", `/api/shared/${sid}/facts/${earsId}`, { aspect: "Ears", text: "Base ears, changed." });
ok(r.status === 200, "the base fact is edited");
ok(find(await state(a2), "Mara Vale").description.startsWith("Ears: Fox ears."), "…the story's own version still wins");
ok(find(await state(a2), "Mara Vale").description.includes("Tail: A fox tail."), "…and its own fact stays");
ok(find(await state(other), "Mara Vale").description === "Ears: Base ears, changed. Eyes: Green.", "…while the other story gets the new base text: " + find(await state(other), "Mara Vale").description);

// Deleting
r = await call("DELETE", `/api/shared/${sid}`);
ok(r.status === 409, "an entry that is in use can't be deleted: " + r.json?.error);
r = await call("GET", `/api/shared/${sid}`);
ok(r.json.used_in.length === 2, "…and says which stories use it");
r = await call("POST", "/api/shared", { name: "Spare" });
const spare = r.json.id;
ok((await call("DELETE", `/api/shared/${spare}`)).status === 200 && (await call("GET", `/api/shared/${spare}`)).status === 404, "an unused entry can be deleted");
ok((await call("DELETE", `/api/shared/${sid}/facts/${eyesId}`)).status === 200, "a fact can be removed from the base");
ok(!find(await state(a2), "Mara Vale").description.includes("Eyes") && !find(await state(other), "Mara Vale").description.includes("Eyes"), "…and is gone from every story");
void b;
