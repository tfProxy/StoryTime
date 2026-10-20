// Basic story / chapter / choice behaviour through the HTTP API.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("POST", "/api/stories", { title: "Test Tale", premise: "p", chapter: { title: "Ch1", body: "Once upon.\n\nA time.", choices: ["Go left", "Go right"] } });
ok(r.status === 201 && r.json.story_id && r.json.chapter_id, "create story");
const { story_id: story, chapter_id: root } = r.json;
let g = await call("GET", `/api/chapters/${root}`);
ok(g.json.choices.length === 2 && g.json.choices.every((c) => c.child_chapter_id === null), "choices start unwritten");
const [left, right] = g.json.choices;

r = await call("POST", "/api/chapters", { title: "Left", body: "You went left", choice_id: left.id, choices: ["Hop"] });
ok(r.status === 201, "fill an unwritten choice");
const leftCh = r.json.chapter_id;
r = await call("POST", "/api/chapters", { title: "Left2", body: "x", choice_id: left.id });
ok(r.status === 409, "first poster wins: " + r.json?.error);
r = await call("POST", "/api/chapters", { title: "Up", body: "up", parent_chapter_id: root, new_choice_label: "Climb" });
ok(r.status === 201, "add a new choice with its chapter");
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.choices.length === 3 && g.json.choices.filter((c) => c.child_chapter_id).length === 2 && g.json.choices[1].id === right.id && g.json.choices[1].child_chapter_id === null, "choices reflect fills");

g = await call("GET", `/api/chapters/${leftCh}`);
ok(g.json.path.map((c) => c.title).join() === "Ch1,Left" && g.json.chapter.depth === 1, "path runs from the root");

r = await call("POST", "/api/chapters", { title: "x", body: "y" });
ok(r.status === 400, "needs a choice or a parent");
r = await call("POST", "/api/chapters", { title: "x", body: "y", choice_id: "nope" });
ok(r.status === 404, "unknown choice 404");
r = await call("POST", "/api/stories", { title: "", chapter: { title: "a", body: "b" } });
ok(r.status === 400, "empty story title rejected");
r = await call("POST", "/api/stories", { title: "T", chapter: { title: "a", body: "b", choices: Array(13).fill("c") } });
ok(r.status === 400, "too many choices rejected");
r = await call("POST", "/api/stories", { title: "T", chapter: { title: "a", body: "b".repeat(50001) } });
ok(r.status === 400, "oversized chapter rejected");
const bad = await fetch(B + "/api/stories", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
ok(bad.status === 400, "invalid JSON rejected");

ok((await call("GET", "/api/stories")).json.some((s) => s.id === story && s.chapter_count === 3), "story listed with chapter count");
for (const u of ["/", "/new", "/settings", "/drafts", `/s/${story}`, `/c/${root}`, `/c/${root}/write`, `/c/${root}/write?choice=${right.id}`, `/c/${root}/codex`, `/c/${root}/history`]) {
  const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`);
}
ok((await fetch(`${B}/c/nope`)).status === 404, "unknown chapter page 404");
ok(!(await (await fetch(`${B}/c/${root}`)).text()).includes("<script>alert"), "pages render text safely");
const xss = await call("POST", "/api/stories", { title: "<script>alert(1)</script>", chapter: { title: "<img src=x onerror=alert(1)>", body: "<b>hi</b>" } });
const page = await (await fetch(`${B}/c/${xss.json.chapter_id}`)).text();
ok(!page.includes("<img src=x") && !page.includes("<b>hi</b>") && page.includes("&lt;b&gt;hi&lt;/b&gt;"), "chapter text is escaped, not injected");

// ---- a story made before its first chapter ----
r = await call("POST", "/api/stories", { title: "Bare", premise: "Nothing yet." });
ok(r.status === 201 && r.json.chapter_id === null && typeof r.json.story_id === "string", "a story can be made with no chapter");
const bare = r.json.story_id;
ok((await call("GET", `/api/stories/${bare}`)).json.root_chapter_id === null, "…and has no first chapter");
ok((await call("GET", "/api/stories")).json.some((s) => s.id === bare && s.chapter_count === 0), "…it is listed, with no chapters");
r = await call("PATCH", `/api/stories/${bare}`, { premise: "Still nothing." });
ok(r.status === 200 && (await call("GET", `/api/stories/${bare}`)).json.premise === "Still nothing.", "…its details can be edited");
for (const u of [`/s/${bare}/details`, `/s/${bare}/write`]) {
  const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`);
}
const toDetails = await fetch(`${B}/s/${bare}`, { redirect: "manual" });
ok(toDetails.status >= 300 && toDetails.status < 400 && (toDetails.headers.get("location") ?? "").endsWith(`/s/${bare}/details`), "its story link leads to its details page");
r = await call("POST", `/api/stories/${bare}/first-chapter`, { title: "One", body: "It began.", choices: ["On"] });
ok(r.status === 201 && r.json.story_id === bare && r.json.choice_ids.length === 1, "its first chapter can be posted");
ok((await call("GET", `/api/stories/${bare}`)).json.root_chapter_id === r.json.chapter_id, "…and becomes the story's first chapter");
r = await call("POST", `/api/stories/${bare}/first-chapter`, { title: "Two", body: "Again." });
ok(r.status === 409, "a second first chapter is refused");
ok((await call("POST", "/api/stories/nope/first-chapter", { title: "a", body: "b" })).status === 404, "…as is one for a story that doesn't exist");
ok((await call("POST", `/api/stories/${bare}/first-chapter`, { title: "", body: "b" })).status === 400, "…or one with no title");

// ---- a story begun on the old New story page keeps its draft ----
const oldDraft = { href: "/new", label: "New story", storyTitle: "Old tale", premise: "", newChoiceLabel: "", title: "Old start", body: "Half written.", choices: [], prompt: "", undo: [] };
await call("PUT", "/api/drafts/story", { draft: oldDraft, base: null });
r = await call("POST", "/api/stories", { title: "Old tale", adopt_draft: true });
const moved = await call("GET", `/api/drafts/first:${r.json.story_id}`);
ok(moved.status === 200 && moved.json.draft.body === "Half written." && moved.json.draft.href === `/s/${r.json.story_id}/write`, "creating a story from the old draft keeps its chapter as the new story's first-chapter draft");
ok((await call("GET", "/api/drafts/story")).status === 404, "…and the old draft is gone");
await call("DELETE", `/api/drafts/first:${r.json.story_id}`);
