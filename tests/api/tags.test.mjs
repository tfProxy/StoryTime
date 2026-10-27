// AI tagging: the shared tag library, per-story switches, suggestions and the author's decisions.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const sfx = Math.random().toString(36).slice(2, 8);
const made = [];
const mk = async (name, extra = {}) => {
  const r = await call("POST", "/api/tags", { name: `${name}-${sfx}`, applies: "when it happens", not_applies: "when it doesn't", ...extra });
  if (r.status === 201) made.push(r.json.id);
  return r;
};

// --- library
let r = await mk("violence", { choices: ["mild", "graphic"] });
ok(r.status === 201 && r.json.kind === "event" && r.json.choices.length === 2 && r.json.examples.length === 0, "tag created with defaults");
const violence = r.json.id;
r = await call("POST", "/api/tags", { name: `VIOLENCE-${sfx}` });
ok(r.status === 400 && r.json.error, "duplicate name (any case) is a 400");
r = await call("POST", "/api/tags", { name: "  " });
ok(r.status === 400, "empty name is a 400");
r = await mk("swearing");
const swearing = r.json.id;
r = await mk("romance");
const romance = r.json.id;
r = await call("PATCH", `/api/tags/${swearing}`, { name: `cursing-${sfx}`, applies: "bad words" });
ok(r.status === 200 && r.json.name === `cursing-${sfx}` && r.json.applies === "bad words" && r.json.not_applies === "when it doesn't", "partial rename");
r = await call("PATCH", `/api/tags/${swearing}`, { name: `Violence-${sfx}` });
ok(r.status === 400, "rename onto an existing name is a 400");
r = await call("PATCH", `/api/tags/${swearing}`, { name: `cursing-${sfx}` });
ok(r.status === 200, "keeping its own name is fine");
r = await call("GET", "/api/tags");
ok(r.json.tags.some((t) => t.id === violence) && r.json.tags.some((t) => t.id === swearing), "listed");
ok(r.json.tags.find((t) => t.id === violence).show_readers === false, "show_readers is false by default and listed");
r = await call("PATCH", `/api/tags/${swearing}`, { show_readers: true });
ok(r.status === 200 && r.json.show_readers === true && r.json.name === `cursing-${sfx}`, "PATCH sets show_readers");
r = await call("GET", "/api/tags");
ok(r.json.tags.find((t) => t.id === swearing).show_readers === true && r.json.tags.find((t) => t.id === violence).show_readers === false, "show_readers is listed per tag");
r = await call("POST", "/api/tags", { name: `readers-${sfx}`, show_readers: true });
ok(r.status === 201 && r.json.show_readers === true, "a tag can be created shown to readers");
await call("DELETE", `/api/tags/${r.json.id}`);
r = await call("PATCH", `/api/tags/${swearing}`, { show_readers: "yes" });
ok(r.status === 400, "show_readers must be a boolean");
r = await call("PATCH", "/api/tags/nope", { name: "x" });
ok(r.status === 404, "unknown tag is a 404");

// --- story setup
r = await call("POST", "/api/stories", { title: "Tags", chapter: { title: "Root", body: "root", summary: "s", choices: ["A", "B"] } });
const story = r.json.story_id, root = r.json.chapter_id;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
const child = (await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Child", body: "child body", summary: "c" })).json.chapter_id;

r = await call("GET", `/api/stories/${story}/tags`);
const mine = [violence, swearing, romance];
ok(r.status === 200 && mine.every((t) => r.json.enabled.includes(t)) && r.json.tags.some((t) => t.id === violence), "every tag is on for a new story; all live tags listed");
r = await call("PUT", `/api/stories/${story}/tags`, { tag_id: violence, on: true });
ok(r.status === 200 && r.json.enabled.includes(violence), "switching on a tag that is already on is harmless");
r = await call("PUT", `/api/stories/${story}/tags`, { tag_id: swearing, on: false });
ok(r.json.enabled.includes(violence) && !r.json.enabled.includes(swearing) && r.json.enabled.includes(romance), "a tag can be switched off");
await call("PUT", `/api/stories/${story}/tags`, { tag_id: swearing, on: false });
r = await call("PUT", `/api/stories/${story}/tags`, { tag_id: romance, on: false });
ok(!r.json.enabled.includes(romance) && !r.json.enabled.includes(swearing), "switching off twice is harmless; a second tag off");
r = await call("PUT", `/api/stories/nope/tags`, { tag_id: violence, on: true });
ok(r.status === 404, "unknown story is a 404");
r = await call("PUT", `/api/stories/${story}/tags`, { tag_id: "nope", on: false });
ok(r.status === 404, "unknown tag is a 404");
const other = (await call("POST", "/api/stories", { title: "Other", chapter: { title: "Root", body: "root", summary: "s", choices: [] } })).json.story_id;
r = await call("GET", `/api/stories/${other}/tags`);
ok(mine.every((t) => r.json.enabled.includes(t)), "switches are per story");

// --- suggestions
const list = async (chapter) => (await call("GET", `/api/stories/${story}/chapter-tags${chapter ? `?chapter=${chapter}` : ""}`)).json.chapter_tags;
const suggest = (chapter, revision, body) => call("POST", `/api/chapters/${chapter}/tags/suggest`, { revision, checked_tag_ids: [], suggestions: [], ...body });
const sug = (tag_id, extra = {}) => ({ tag_id, value: null, quote: "a quote", reason: "a reason", ...extra });

r = await suggest(child, 1, { suggestions: [sug(violence, { value: "graphic" }), sug(swearing), sug(romance)] });
ok(r.status === 200 && r.json.added === 1 && r.json.kept === 0, "a switched-off tag is ignored, the one that is on is added: " + JSON.stringify(r.json));
let ct = await list();
ok(ct.length === 1 && ct[0].tag_name === `violence-${sfx}` && ct[0].status === "suggested" && ct[0].source === "ai" && ct[0].value === "graphic" && ct[0].chapter_title === "Child" && ct[0].stale === false, "listed as suggested");
ok((await list(root)).length === 0 && (await list(child)).length === 1, "chapter filter");
r = await suggest(child, 2, { suggestions: [sug(violence)] });
ok(r.status === 409, "wrong revision is a 409");
r = await suggest("nope", 1, {});
ok(r.status === 404, "unknown chapter is a 404");

// invalid value is dropped, not rejected
r = await suggest(child, 1, { suggestions: [sug(violence, { value: "extreme" })] });
ct = await list();
ok(r.json.added === 1 && ct.length === 1 && ct[0].value === null, "a value outside the choices becomes none; re-suggesting updates the row");

// approve with a value
const id1 = ct[0].id;
r = await call("PATCH", `/api/chapter-tags/${id1}`, { status: "approved", value: "mild" });
ok(r.status === 200 && r.json.status === "approved" && r.json.value === "mild", "approve with a value");
r = await call("PATCH", `/api/chapter-tags/${id1}`, { status: "approved", value: "nonsense" });
ok(r.status === 400, "value not in choices is a 400");
r = await suggest(child, 1, { suggestions: [sug(violence, { value: "graphic" })] });
ct = await list();
ok(r.json.added === 0 && r.json.kept === 1 && ct[0].status === "approved" && ct[0].value === "mild", "approved is not overwritten");

// reject, then re-suggest
r = await call("PATCH", `/api/chapter-tags/${id1}`, { status: "rejected" });
ok(r.json.status === "rejected", "reject");
r = await suggest(child, 1, { suggestions: [sug(violence)] });
ok(r.json.added === 0 && r.json.kept === 1 && (await list())[0].status === "rejected", "rejected at the same revision is not raised again");

// edit the chapter -> suggestible again, and the old tag was stale meanwhile
r = await call("PATCH", `/api/chapters/${child}`, { base_revision: 1, title: "Child", body: "new body", summary: "c" });
ok(r.status === 200, "chapter edited");
ct = await list();
ok(ct[0].stale === true, "tag made from an older revision is stale");
r = await suggest(child, 2, { suggestions: [sug(violence, { quote: "new quote" })] });
ct = await list();
ok(r.json.added === 1 && ct[0].status === "suggested" && ct[0].quote === "new quote" && ct[0].revision === 2 && ct[0].stale === false, "after an edit it is suggested again");

// checked_tag_ids clears stale suggestions
await call("PUT", `/api/stories/${story}/tags`, { tag_id: swearing, on: true });
await suggest(child, 2, { suggestions: [sug(swearing)] });
ok((await list()).length === 2, "two suggestions");
r = await suggest(child, 2, { checked_tag_ids: [violence, swearing], suggestions: [sug(violence)] });
ct = await list();
ok(ct.length === 1 && ct[0].tag_id === violence, "a checked tag the AI did not raise again loses its suggestion");
const vid = ct[0].id;
await call("PATCH", `/api/chapter-tags/${vid}`, { status: "approved" });
r = await suggest(child, 2, { checked_tag_ids: [violence], suggestions: [] });
ok((await list()).length === 1, "an approved tag survives a check that did not raise it");

// a check is recorded even when nothing was suggested, and a changed rule forgets it
const checkedFor = async () => (await call("GET", `/api/stories/${story}/chapter-tags`)).json.checked[child];
r = await suggest(child, 2, { checked_tag_ids: [swearing], suggestions: [] });
ok(JSON.stringify(await checkedFor()) === JSON.stringify([swearing]), "a check with no suggestions is recorded");
await call("PATCH", `/api/tags/${violence}`, { applies: "unrelated rule change" });
ok(JSON.stringify(await checkedFor()) === JSON.stringify([swearing]), "changing the rule of a tag that was not checked keeps the check");
r = await call("PATCH", `/api/tags/${swearing}`, { show_readers: false });
ok(r.status === 200 && r.json.show_readers === false && JSON.stringify(await checkedFor()) === JSON.stringify([swearing]), "changing show_readers keeps the checks");
await call("PATCH", `/api/tags/${swearing}`, { applies: "bad words, changed" });
ok((await checkedFor()) === undefined, "changing a checked tag's rule forgets the check");

// pending markers are not decided yet; by hand
r = await call("POST", `/api/chapters/${root}/tags`, { tag_id: swearing, value: null });
ok(r.status === 201 && r.json.status === "approved" && r.json.source === "author" && r.json.chapter_id === root, "added by hand");
r = await call("POST", `/api/chapters/${root}/tags`, { tag_id: romance });
ok(r.status === 400, "a tag switched off for the story can't be added by hand");
r = await call("POST", `/api/chapters/${root}/tags`, { tag_id: violence, value: "bad" });
ok(r.status === 400, "an invalid value by hand is a 400");
ct = await list();
ok(ct[0].chapter_id === root, "ordered by chapter depth first");

// reject with add_example
await call("PUT", `/api/stories/${story}/tags`, { tag_id: romance, on: true });
await suggest(root, 1, { suggestions: [sug(romance, { quote: "they shook hands", reason: "just polite" })] });
const rid = (await list(root)).find((c) => c.tag_id === romance).id;
r = await call("PATCH", `/api/chapter-tags/${rid}`, { status: "rejected", add_example: true });
ok(r.status === 200, "rejected with add_example");
r = await call("GET", "/api/tags");
const ex = r.json.tags.find((t) => t.id === romance).examples;
ok(ex.length === 1 && ex[0].text === "they shook hands" && ex[0].applies === false && ex[0].note === "just polite", "the quote became a negative example");

r = await call("POST", `/api/tags/${romance}/examples`, { text: "a kiss", applies: true });
ok(r.status === 201 && r.json.examples.length === 2 && r.json.examples[1].applies === true, "example added directly");
r = await call("POST", `/api/tags/${romance}/examples`, { text: "", applies: true });
ok(r.status === 400, "empty example is a 400");

// delete a chapter tag
r = await call("DELETE", `/api/chapter-tags/${rid}`);
ok(r.status === 200 && (await list(root)).every((c) => c.tag_id !== romance), "chapter tag deleted");
r = await call("DELETE", `/api/chapter-tags/${rid}`);
ok(r.status === 404, "deleting again is a 404");

// switching a tag off hides its chapter tags and keeps them for when it is switched on again
const withViolence = (await list()).filter((c) => c.tag_id === violence).length;
await call("PUT", `/api/stories/${story}/tags`, { tag_id: violence, on: false });
ok(withViolence > 0 && (await list()).every((c) => c.tag_id !== violence), "a switched-off tag's chapter tags are hidden");
await call("PUT", `/api/stories/${story}/tags`, { tag_id: violence, on: true });
ok((await list()).filter((c) => c.tag_id === violence).length === withViolence, "…and come back when it is switched on again");

// removed tags disappear
r = await call("DELETE", `/api/tags/${swearing}`);
ok(r.status === 200, "tag removed");
ok((await list()).every((c) => c.tag_id !== swearing), "its chapter tags are hidden");
r = await call("GET", `/api/stories/${story}/tags`);
ok(!r.json.tags.some((t) => t.id === swearing) && !r.json.enabled.includes(swearing), "removed tag is gone from the library and the story");
r = await mk("cursing");
ok(r.status === 201, "a removed tag's name can be reused");

// --- cleanup
for (const id of made) await call("DELETE", `/api/tags/${id}`);
r = await call("GET", "/api/tags");
ok(!r.json.tags.some((t) => t.name.endsWith(`-${sfx}`)), "test tags removed");
