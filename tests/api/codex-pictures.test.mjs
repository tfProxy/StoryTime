// Pictures of codex entries: recording codex jobs, saving a picture from the start or from a chapter on,
// which picture an entry has at a chapter (the nearest anchor on the path wins, on its branch only),
// removing one, and the codex page's prompt boxes and preset.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// story: root -> A -> A2 ;  root -> B
let r = await call("POST", "/api/stories", { title: "Codex pictures", chapter: { title: "Root", body: "r", choices: ["A", "B"] } });
const story = r.json.story_id, root = r.json.chapter_id;
const ch = (await call("GET", `/api/chapters/${root}`)).json.choices;
const fill = async (choice, title, choices = []) => (await call("POST", "/api/chapters", { choice_id: choice.id, title, body: title, choices })).json.chapter_id;
const a = await fill(ch[0], "A", ["A2"]);
const a2 = await fill((await call("GET", `/api/chapters/${a}`)).json.choices[0], "A2");
const b = await fill(ch[1], "B");
const mira = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Mira", type: "character", content: "A thief." })).json.entry_id;
const inn = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "The Inn", type: "place", content: "A tavern." })).json.entry_id;

const url = `/api/stories/${story}/codex-pictures`;
const save = (entry, anchor, bytes = png, query = "") =>
  fetch(`${B}${url}?entry=${entry}${anchor ? `&anchor=${anchor}` : ""}${query}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes });
const at = async (chapter, entry) => (await call("GET", `${url}?chapter=${chapter}`)).json.pictures[entry]?.id ?? null;

// ---- recording codex jobs ----
const base = (n, extra = {}) => ({
  prompt_id: `codex-p${n}`, prompt: `codex ${n}`, negative: `neg ${n}`, checkpoint: "sdxl.safetensors",
  width: 832, height: 1216, seed: 300 + n, count: 2,
  images: [0, 1].map((i) => ({ filename: `StoryTime_x${n}_${i}.png`, subfolder: `StoryTime/${story}/codex/${mira}`, type: "output" })),
  ...extra,
});
const codexJob = (n, extra = {}) => base(n, { story_id: story, entry_id: mira, moment: "codex", ...extra });
r = await call("POST", "/api/picture-jobs", codexJob(1));
const job = r.json;
ok(r.status === 201 && job.story_id === story && job.chapter_id === null && job.entry_id === mira && job.moment === "codex", "a codex job is recorded for its story and entry, with no chapter");
r = await call("POST", "/api/picture-jobs", { ...codexJob(1), prompt: "something else" });
ok(r.status === 201 && r.json.id === job.id, "recording the same ComfyUI job again returns the first record");
for (const [what, bad] of [
  ["a codex job without its entry", codexJob(2, { entry_id: undefined })],
  ["an entry on a cover job", base(2, { story_id: story, moment: "cover", entry_id: mira })],
  ["an entry on a chapter's job", base(2, { chapter_id: root, moment: "start", entry_id: mira })],
  ["a codex job with the moment cover", codexJob(2, { moment: "cover" })],
]) {
  const x = await call("POST", "/api/picture-jobs", bad);
  ok(x.status === 400 && x.json?.error, `rejected: ${what}`);
}
ok((await call("POST", "/api/picture-jobs", codexJob(3, { entry_id: "nope" }))).status === 404, "an entry that doesn't exist can't have jobs");
await call("POST", "/api/picture-jobs", base(4, { story_id: story, moment: "cover" }));
await call("POST", "/api/picture-jobs", codexJob(5, { entry_id: inn }));
r = await call("GET", `/api/picture-jobs?cover=${story}`);
ok(r.json.jobs.length === 1 && r.json.jobs[0].moment === "cover", "the cover's list leaves codex jobs out");
r = await call("GET", `/api/picture-jobs?story=${story}&chapters=1`);
ok(r.json.jobs.length === 0, "the chapters' list leaves them out too");
r = await call("GET", `/api/picture-jobs?story=${story}&entry=${mira}`);
ok(r.json.jobs.map((j) => j.prompt_id).join() === "codex-p1", "?story&entry lists one entry's jobs");

// ---- saving and resolving ----
ok((await fetch(`${B}${url}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png })).status === 400, "a picture needs its entry");
ok((await save("nope", null)).status === 404, "…which must exist");
ok((await save(mira, "nope")).status === 404, "…and the chapter it starts at");
ok((await save(mira, null, Buffer.from("not an image"))).status === 415, "…and be an image");
ok((await at(root, mira)) === null, "an entry starts with no picture");
r = await save(mira, null, png, `&job=${job.id}&index=1`);
const whole = (await r.json()).id;
ok(r.status === 201 && typeof whole === "string", "a picture can be saved for the whole story, with the job that made it");
const marks = (await call("GET", `${url}?entry=${mira}`)).json;
ok(marks.pictures.length === 1 && marks.pictures[0].made.prompt === "codex 1" && marks.pictures[0].made.from.index === 1, "…its prompt and picture are kept");
ok((await at(root, mira)) === whole && (await at(a2, mira)) === whole && (await at(b, mira)) === whole, "it applies at every chapter");
ok((await call("GET", `${url}?chapter=nope`)).status === 404, "a chapter that isn't in the story is refused");
r = await fetch(`${B}${url}/${whole}`);
ok(r.status === 200 && r.headers.get("content-type") === "image/png" && Buffer.from(await r.arrayBuffer()).equals(png) && r.headers.get("x-content-type-options") === "nosniff", "the picture's bytes come back as saved");
ok((await fetch(`${B}${url}/${whole}`, { headers: { "If-None-Match": r.headers.get("etag") } })).status === 304, "…and are cached");
ok((await fetch(`${B}/api/stories/other/codex-pictures/${whole}`)).status === 404, "…only in their own story");

await new Promise((x) => setTimeout(x, 5));
const fromA = (await (await save(mira, a)).json()).id;
ok((await at(root, mira)) === whole && (await at(b, mira)) === whole, "a picture from chapter A on leaves the root and branch B alone");
ok((await at(a, mira)) === fromA && (await at(a2, mira)) === fromA, "…and applies to A and below");
const later = (await (await save(mira, null)).json()).id;
ok((await at(a2, mira)) === fromA && (await at(b, mira)) === later && (await at(root, mira)) === later, "a later whole-story picture doesn't override the deeper one");
const a2own = (await (await save(mira, a2)).json()).id;
ok((await at(a2, mira)) === a2own && (await at(a, mira)) === fromA, "the nearest anchor wins");
const again = (await (await save(mira, a2)).json()).id;
ok((await at(a2, mira)) === again, "at the same chapter the later one wins");
r = await call("GET", `${url}?chapter=${a2}&entry=${mira}`);
ok(r.json.pictures.length === 5 && r.json.current.id === again && r.json.pictures[0].id === again, "an entry's list has every picture, newest first, and the current one");
ok(Object.keys((await call("GET", `${url}`)).json.pictures).length === 1, "without a chapter only the whole story's pictures count");
ok(Object.keys((await call("GET", `${url}?chapter=${a2}`)).json.pictures).length === 1 && (await at(a2, inn)) === null, "an entry with no picture has none at any chapter");
ok((await call("GET", `${url}?chapter=${a2}`)).json.ids.length === 5, "the ids of every picture are listed");

// ---- removing ----
ok((await fetch(`${B}${url}/${again}`, { method: "DELETE" })).status === 200, "a picture can be removed");
ok((await at(a2, mira)) === a2own, "…and the one before it shows again");
ok((await fetch(`${B}${url}/${again}`)).status === 404 && (await fetch(`${B}${url}/${again}`, { method: "DELETE" })).status === 404, "…it is gone, and can't be removed twice");

// ---- the codex page's prompt boxes ----
const draft = `/api/stories/${story}/codex-draft?entry=${mira}`;
ok((await call("GET", draft)).json.draft === null, "an entry starts with no saved prompt");
r = await call("PUT", draft, { prompt: "a “thief”", negative: "blur", scene: "sc", direction: "dir", refs: [{ source: "codex:abc", label: "Mira", role: "character", weight: 0.7 }] });
ok(r.status === 200, "the prompt boxes can be saved");
ok(JSON.stringify((await call("GET", draft)).json.draft) === JSON.stringify({ prompt: "a “thief”", negative: "blur", scene: "sc", direction: "dir", refs: [{ source: "codex:abc", label: "Mira", role: "character", weight: 0.7 }] }), "…and come back as saved");
ok((await call("GET", `/api/stories/${story}/codex-draft?entry=${inn}`)).json.draft === null, "…for that entry only");
ok((await call("PUT", draft, { refs: Array.from({ length: 5 }, () => ({ source: "s", label: "l", role: "item", weight: 0.5 })) })).status === 400, "at most four references");
ok((await call("PUT", `/api/stories/${story}/codex-draft?entry=nope`, { prompt: "x" })).status === 404, "an entry that doesn't exist is refused");
ok((await call("GET", `/api/stories/${story}/codex-draft`)).status === 400, "the entry must be given");

// ---- the entry's drawing preset ----
const preset = `/api/stories/${story}/codex-preset?entry=${mira}`;
ok((await call("GET", preset)).json.draw_preset === null, "an entry follows the story's drawing preset until one is chosen");
ok((await call("PUT", preset, { draw_preset: "anime" })).status === 200 && (await call("GET", preset)).json.draw_preset === "anime", "it can choose its own");
await call("PUT", draft, { prompt: "again" });
ok((await call("GET", preset)).json.draw_preset === "anime", "saving the boxes leaves the preset alone");
