// Clearing the codex inbox in one go: POST /api/stories/<id>/codex-suggestions dismisses every open suggestion of the story,
// or only one entry's ({ entry_id }), or only those made from some chapters ({ chapter_ids }), or both. Accepted
// suggestions and the codex's facts stay; a dismissed one can be reopened; another story's inbox is never touched.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const stories = [];
try {
  // Root with two branches: A and B. Rowan and Kestrel are in the codex from the root.
  const s = await call("POST", "/api/stories", { title: "Dismiss open", premise: "P", chapter: { title: "Root", body: "Rowan and Kestrel stood there.", summary: "s", choices: ["Go", "Stay"] } });
  const story = s.json.story_id;
  stories.push(story);
  const root = s.json.chapter_id;
  const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const A = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Chapter A", body: "Her ears changed. Her hair was silver. Wings. Brindle the fox came.", summary: "s" })).json.chapter_id;
  const Bc = (await call("POST", "/api/chapters", { choice_id: choices[1].id, title: "Chapter B", body: "Her eyes were amber. A long beak.", summary: "s" })).json.chapter_id;
  const rowan = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Rowan", type: "character" })).json.entry_id;
  const kestrel = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Kestrel", type: "character" })).json.entry_id;
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: rowan, op: "set", aspect: "Ears", form: "", text: "Human ears." });
  await call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: rowan, op: "set", aspect: "Hair", form: "", text: "Black hair." });

  const set = (entry_id, aspect, after, quote) => ({ kind: "set", entry_id, aspect, form: "", after, quote });
  const post = (chapter, list) => call("POST", `/api/chapters/${chapter}/codex-suggestions`, { revision: 1, suggestions: list });
  const inbox = async (status, id = story) => (await call("GET", `/api/stories/${id}/codex-suggestions?status=${status}`)).json.suggestions;
  const label = (x) => `${x.entry_name ?? x.entry?.name}/${x.aspect || "new"}/${x.chapter_title}`;
  const names = async (status) => (await inbox(status)).map(label).sort().join(", ");
  const dismiss = (body, id = story) => call("POST", `/api/stories/${id}/codex-suggestions`, body);

  const a = await post(A, [
    set(rowan, "Ears", "Tall fox ears.", "Her ears changed"),
    set(rowan, "Hair", "Silver hair.", "Her hair was silver"),
    set(kestrel, "Wings", "Broad wings.", "Wings"),
    { kind: "entry", entry: { name: "Brindle", type: "character", aliases: [], notes: "A fox.", facts: [] }, quote: "Brindle the fox came" },
  ]);
  const b = await post(Bc, [set(rowan, "Eyes", "Amber eyes.", "Her eyes were amber"), set(kestrel, "Beak", "A long beak.", "A long beak")]);
  ok(a.json.saved === 4 && b.json.saved === 2, "six suggestions wait in two chapters: " + JSON.stringify([a.json, b.json]));

  // One of them is accepted already: it must stay accepted whatever is dismissed.
  const hair = (await inbox("open")).find((x) => x.aspect === "Hair");
  ok((await call("POST", `/api/codex-suggestions/${hair.id}/accept`)).status === 200, "Rowan's hair is accepted");
  const hairAt = async () => (await call("GET", `/api/chapters/${A}/codex`)).json.entries.find((e) => e.name === "Rowan").facts.find((f) => f.aspect === "Hair").text;
  ok((await hairAt()) === "Silver hair.", "…and the fact is in the codex");
  ok((await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.counts.total === 5, "five are open");

  // ---- one entry ----
  let r = await dismiss({ entry_id: rowan });
  ok(r.status === 200 && r.json.dismissed === 2, "{ entry_id } dismisses that entry's open suggestions (Ears and Eyes): " + JSON.stringify(r.json));
  ok((await names("open")) === "Brindle/new/Chapter A, Kestrel/Beak/Chapter B, Kestrel/Wings/Chapter A", "…and leaves the other entry's and the new-entry proposal: " + (await names("open")));
  ok((await names("dismissed")) === "Rowan/Ears/Chapter A, Rowan/Eyes/Chapter B", "…which are now dismissed: " + (await names("dismissed")));

  // ---- some chapters ----
  r = await dismiss({ chapter_ids: [Bc] });
  ok(r.status === 200 && r.json.dismissed === 1, "{ chapter_ids } dismisses those chapters' open suggestions (Kestrel's beak): " + JSON.stringify(r.json));
  ok((await names("open")) === "Brindle/new/Chapter A, Kestrel/Wings/Chapter A", "…and leaves the other chapter's: " + (await names("open")));
  r = await dismiss({ chapter_ids: [root] });
  ok(r.status === 200 && r.json.dismissed === 0, "a chapter with none waiting dismisses nothing: " + JSON.stringify(r.json));

  // ---- both: only what matches both ----
  const eyes = (await inbox("dismissed")).find((x) => x.aspect === "Eyes");
  ok((await call("POST", `/api/codex-suggestions/${eyes.id}/reopen`)).status === 200, "Rowan's eyes (Chapter B) are reopened");
  r = await dismiss({ entry_id: rowan, chapter_ids: [A] });
  ok(r.status === 200 && r.json.dismissed === 0, "{ entry_id, chapter_ids } needs both to match (Rowan waits only in Chapter B): " + JSON.stringify(r.json));
  r = await dismiss({ entry_id: kestrel, chapter_ids: [A, Bc] });
  ok(r.status === 200 && r.json.dismissed === 1 && (await names("open")) === "Brindle/new/Chapter A, Rowan/Eyes/Chapter B", "…and dismisses what does (Kestrel's wings): " + JSON.stringify(r.json) + " " + (await names("open")));

  // ---- another story is never touched, whatever ids are given ----
  const o = await call("POST", "/api/stories", { title: "Other", premise: "P", chapter: { title: "Root", body: "Mira stood.", summary: "s", choices: ["Go"] } });
  stories.push(o.json.story_id);
  const mira = (await call("POST", "/api/codex", { anchor_chapter_id: o.json.chapter_id, op: "create", name: "Mira", type: "character" })).json.entry_id;
  await call("POST", `/api/chapters/${o.json.chapter_id}/codex-suggestions`, { revision: 1, suggestions: [set(mira, "Ears", "Tall ears.", "Mira stood")] });
  r = await dismiss({ entry_id: mira, chapter_ids: [o.json.chapter_id] });
  ok(r.status === 200 && r.json.dismissed === 0 && (await inbox("open", o.json.story_id)).length === 1, "another story's entry and chapter ids dismiss nothing here, and its inbox stays open");

  // ---- everything ----
  r = await dismiss({});
  ok(r.status === 200 && r.json.dismissed === 2, "{} dismisses the rest, the new-entry proposal too: " + JSON.stringify(r.json));
  const left = (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json;
  ok(left.suggestions.length === 0 && left.counts.total === 0, "nothing is open, and the count says so");
  ok((await inbox("dismissed")).length === 5 && (await inbox("accepted")).length === 1 && (await inbox("accepted"))[0].aspect === "Hair", "five are dismissed; the accepted one stays accepted");
  ok((await hairAt()) === "Silver hair.", "the fact it made is still in the codex");
  const rowanAtA = (await call("GET", `/api/chapters/${A}/codex`)).json.entries.find((e) => e.name === "Rowan");
  ok(rowanAtA.facts.find((f) => f.aspect === "Ears").text === "Human ears." && !rowanAtA.facts.some((f) => f.aspect === "Eyes"), "dismissing changed no other fact (Ears are still as they were, no Eyes)");
  ok(!(await call("GET", `/api/chapters/${A}/codex`)).json.entries.some((e) => e.name === "Brindle"), "…and the proposed entry was not added");
  r = await dismiss({});
  ok(r.status === 200 && r.json.dismissed === 0, "with none waiting, { } dismisses nothing: " + JSON.stringify(r.json));
  ok((await inbox("open", o.json.story_id)).length === 1, "the other story's suggestion is still open");

  // ---- reopen ----
  const brindle = (await inbox("dismissed")).find((x) => x.kind === "entry");
  r = await call("POST", `/api/codex-suggestions/${brindle.id}/reopen`);
  ok(r.status === 200 && (await names("open")) === "Brindle/new/Chapter A", "a dismissed suggestion can be reopened: " + (await names("open")));
  const wings = (await inbox("dismissed")).find((x) => x.aspect === "Wings");
  ok((await call("POST", `/api/codex-suggestions/${wings.id}/accept`)).status === 409, "…and one still dismissed can't be accepted until it is");
  ok((await call("POST", `/api/codex-suggestions/${wings.id}/reopen`)).status === 200 && (await call("POST", `/api/codex-suggestions/${wings.id}/accept`)).status === 200, "…reopened, it can be accepted");

  // ---- refusals ----
  r = await dismiss({}, "nope");
  ok(r.status === 404, "an unknown story is 404: " + r.status);
  for (const [what, body] of [["an empty chapter list", { chapter_ids: [] }], ["an empty entry id", { entry_id: "" }], ["chapter_ids that is not a list", { chapter_ids: A }], ["an empty chapter id", { chapter_ids: [""] }]]) {
    r = await dismiss(body);
    ok(r.status === 400 && typeof r.json.error === "string", `${what} is 400: ${r.status}`);
  }
  r = await call("POST", `/api/stories/${story}/codex-suggestions`);
  ok(r.status === 400, "no body is 400: " + r.status);
  ok((await names("open")) === "Brindle/new/Chapter A", "a refused request dismisses nothing");
} finally {
  for (const id of stories) await call("DELETE", `/api/stories/${id}`);
}
