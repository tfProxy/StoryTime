// Per-story style notes, and the choice ids returned when posting.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("POST", "/api/stories", { title: "Styled", premise: "p", style: "  First person, past tense.  ", chapter: { title: "Root", body: "b", choices: ["Left", "Right", "Wait"] } });
ok(r.status === 201 && r.json.choice_ids?.length === 3, "posting a story returns its choices' ids");
const { story_id: story, chapter_id: root } = r.json;
const choices = (await call("GET", `/api/chapters/${root}`)).json.choices;
ok(["Left", "Right", "Wait"].every((l, i) => choices.find((c) => c.id === r.json.choice_ids[i])?.label === l), "…in the order they were given");

let s = (await call("GET", `/api/stories/${story}`)).json;
ok(s.style === "First person, past tense.", "a new story keeps its style notes, trimmed");
ok((await call("POST", "/api/stories", { title: "Plain", chapter: { title: "R", body: "b" } })).json.choice_ids.length === 0, "a story without style notes or choices is fine");

r = await call("POST", "/api/chapters", { choice_id: choices[0].id, title: "Next", body: "b", choices: ["Up", "Down"] });
ok(r.status === 201 && r.json.choice_ids.length === 2, "posting a chapter returns its choices' ids");
r = await call("POST", "/api/chapters", { parent_chapter_id: root, new_choice_label: "Jump", title: "J", body: "b" });
ok(r.status === 201 && Array.isArray(r.json.choice_ids) && r.json.choice_ids.length === 0, "…an empty list when it has none");

r = await call("PATCH", `/api/stories/${story}`, { style: "Third person, present tense." });
s = (await call("GET", `/api/stories/${story}`)).json;
ok(r.status === 200 && s.style === "Third person, present tense." && s.title === "Styled" && s.premise === "p", "style notes can be saved on their own, leaving the title and premise");
await call("PATCH", `/api/stories/${story}`, { title: "Styled 2", premise: "q" });
s = (await call("GET", `/api/stories/${story}`)).json;
ok(s.title === "Styled 2" && s.premise === "q" && s.style === "Third person, present tense.", "editing the title and premise leaves the style notes");
ok((await call("PATCH", `/api/stories/${story}`, { title: "" })).status === 400, "the title still can't be emptied");
ok((await call("PATCH", `/api/stories/${story}`, { style: "x".repeat(3001) })).status === 400, "style notes have a length limit");
await call("PATCH", `/api/stories/${story}`, { style: "" });
ok((await call("GET", `/api/stories/${story}`)).json.style === "", "style notes can be cleared");

// ---- the art style for picture prompts ----
ok(s.art_style === "", "a new story has no art style");
r = await call("PATCH", `/api/stories/${story}`, { art_style: "  Watercolor storybook, soft muted palette.  " });
s = (await call("GET", `/api/stories/${story}`)).json;
ok(r.status === 200 && s.art_style === "Watercolor storybook, soft muted palette." && s.style === "" && s.title === "Styled 2" && s.premise === "q", "the art style can be saved on its own (trimmed), leaving the other fields");
await call("PATCH", `/api/stories/${story}`, { style: "Keep it short.", title: "Styled 3" });
s = (await call("GET", `/api/stories/${story}`)).json;
ok(s.art_style === "Watercolor storybook, soft muted palette." && s.style === "Keep it short." && s.title === "Styled 3", "editing the other fields leaves the art style");
ok((await call("PATCH", `/api/stories/${story}`, { art_style: "x".repeat(1001) })).status === 400, "the art style has a length limit");
ok((await call("PATCH", `/api/stories/${story}`, { art_style: "x".repeat(1000) })).status === 200 && (await call("GET", `/api/stories/${story}`)).json.art_style.length === 1000, "…of 1000 characters");
ok((await call("GET", `/api/stories`)).json.find((x) => x.id === story)?.art_style?.length === 1000, "the story list carries it too");
await call("PATCH", `/api/stories/${story}`, { art_style: "" });
ok((await call("GET", `/api/stories/${story}`)).json.art_style === "", "the art style can be cleared");
await call("PATCH", `/api/stories/${story}`, { art_style: "Ink and wash." });
const plainExport = await (await fetch(`${B}/api/stories/${story}/export?format=json`)).json();
ok(plainExport.story.art_style === "Ink and wash.", "the JSON export includes the art style");
r = await call("POST", "/api/stories/import", plainExport);
ok(r.status === 201 && (await call("GET", `/api/stories/${r.json.story_id}`)).json.art_style === "Ink and wash.", "…and importing it brings it back");
delete plainExport.story.art_style;
r = await call("POST", "/api/stories/import", plainExport);
ok(r.status === 201 && (await call("GET", `/api/stories/${r.json.story_id}`)).json.art_style === "", "an older export without an art style imports with none");
const tooLong = structuredClone(plainExport); tooLong.story.art_style = "x".repeat(1001);
ok((await call("POST", "/api/stories/import", tooLong)).status === 400, "an import with an over-long art style is refused");

// export and import keep them
await call("PATCH", `/api/stories/${story}`, { style: "Keep it short." });
const exported = await (await fetch(`${B}/api/stories/${story}/export?format=json`)).json();
ok(exported.story?.style === "Keep it short.", "the JSON export includes the style notes");
r = await call("POST", "/api/stories/import", exported);
ok(r.status === 201 && (await call("GET", `/api/stories/${r.json.story_id}`)).json.style === "Keep it short.", "…and importing it brings them back");
delete exported.story.style;
r = await call("POST", "/api/stories/import", exported);
ok(r.status === 201 && (await call("GET", `/api/stories/${r.json.story_id}`)).json.style === "", "an older export without style notes still imports");
