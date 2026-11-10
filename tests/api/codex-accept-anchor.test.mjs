// Accepting a suggestion from an earlier chapter (the entry page's "Keep from where she first appears"):
// anchor_chapter_id must be on the way to the suggestion's chapter, and the fact then reads that way from there.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const post = (url, body) => call("POST", url, body);

// Root -> A -> A2, and Root -> Side
const story = (await post("/api/stories", { title: "Anchor Tale", premise: "p", chapter: { title: "Root", body: "Wren.", choices: ["A", "Side"] } })).json;
const R = story.chapter_id;
const [toA, toSide] = (await call("GET", `/api/chapters/${R}`)).json.choices;
const A = (await post("/api/chapters", { choice_id: toA.id, title: "A", body: "Wren again.", choices: ["On"] })).json.chapter_id;
const A2 = (await post("/api/chapters", { choice_id: (await call("GET", `/api/chapters/${A}`)).json.choices[0].id, title: "A2", body: "Wren still.", choices: [] })).json.chapter_id;
const Side = (await post("/api/chapters", { choice_id: toSide.id, title: "Side", body: "Elsewhere.", choices: [] })).json.chapter_id;
const wren = (await post("/api/codex", { anchor_chapter_id: R, op: "create", name: "Wren", type: "character", content: "" })).json.entry_id;
const rev = async (id) => (await call("GET", `/api/chapters/${id}`)).json.chapter.revision;
// Flesh out at A2: two of the AI's own ideas.
await post(`/api/chapters/${A2}/codex-suggestions`, {
  revision: await rev(A2),
  source: "expand",
  entry_id: wren,
  suggestions: [
    { kind: "set", entry_id: wren, aspect: "Voice", after: "low and dry", quote: "" },
    { kind: "set", entry_id: wren, aspect: "Family", after: "a brother", quote: "" },
  ],
});
const open = (await call("GET", `/api/stories/${story.story_id}/codex-suggestions?status=open`)).json.suggestions;
const voice = open.find((s) => s.aspect === "Voice");
const family = open.find((s) => s.aspect === "Family");
const factAt = async (chapter, aspect) => (await call("GET", `/api/chapters/${chapter}/codex`)).json.entries.find((e) => e.name === "Wren")?.description.includes(aspect);

let r = await post(`/api/codex-suggestions/${voice.id}/accept`, { anchor_chapter_id: Side });
ok(r.status === 400, "a chapter on another branch is refused: " + r.status);
r = await post(`/api/codex-suggestions/${voice.id}/accept`, { anchor_chapter_id: "nope" });
ok(r.status === 400, "…and so is one that doesn't exist");
ok((await call("GET", `/api/stories/${story.story_id}/codex-suggestions?status=open`)).json.suggestions.some((s) => s.id === voice.id), "…and the suggestion stays open");

r = await post(`/api/codex-suggestions/${voice.id}/accept`, { anchor_chapter_id: R, text: "low and dusty" });
ok(r.status === 200 && r.json.entry_id === wren, "an earlier chapter on the way is taken, with the owner's edit");
ok((await factAt(R, "Voice: low and dusty")) && (await factAt(Side, "Voice: low and dusty")), "the fact reads from the root on, on every branch from it");

r = await post(`/api/codex-suggestions/${family.id}/accept`, {});
ok(r.status === 200 && (await factAt(A2, "Family: a brother")) && !(await factAt(A, "Family")), "without an anchor it is written at the suggestion's own chapter");
