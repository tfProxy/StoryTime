// Pictures made for a story's cover: recording cover jobs (a story, no chapter), listing them apart from the
// chapters', saving one as the cover with the job that made it, and the cover page's prompt boxes and preset.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const putCover = (story, query = "") => fetch(`${B}/api/stories/${story}/cover${query}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });

const made = await call("POST", "/api/stories", { title: "Covers", chapter: { title: "One", body: "first", choices: [] } });
const story = made.json.story_id, one = made.json.chapter_id;

const base = (n, extra = {}) => ({
  prompt_id: `cover-p${n}`, prompt: `cover ${n}`, negative: `neg ${n}`, checkpoint: "sdxl.safetensors",
  width: 832, height: 1216, seed: 200 + n, count: 2,
  images: [0, 1].map((i) => ({ filename: `StoryTime_c${n}_${i}.png`, subfolder: `StoryTime/${story}/cover`, type: "output" })),
  ...extra,
});
const coverJob = (n, extra = {}) => base(n, { story_id: story, moment: "cover", ...extra });

// ---- recording ----
let r = await call("POST", "/api/picture-jobs", coverJob(1));
const first = r.json;
ok(r.status === 201 && first.story_id === story && first.chapter_id === null && first.moment === "cover", "a cover job is recorded for its story, with no chapter");
r = await call("POST", "/api/picture-jobs", { ...coverJob(1), prompt: "something else" });
ok(r.status === 201 && r.json.id === first.id && r.json.prompt === "cover 1", "recording the same ComfyUI job again returns the first record");
r = await call("POST", "/api/picture-jobs", base(1, { chapter_id: one, moment: "start" }));
ok(r.status === 201 && r.json.id !== first.id && r.json.chapter_id === one, "the same ComfyUI job id for a chapter is a separate record");
ok((await call("POST", "/api/picture-jobs", coverJob(2, { story_id: "nope" }))).status === 404, "a story that doesn't exist can't have cover jobs");
const refuse = async (what, job) => {
  const x = await call("POST", "/api/picture-jobs", job);
  ok(x.status === 400 && x.json?.error, `rejected: ${what} (${x.json?.error})`);
};
await refuse("a cover job without the moment cover", coverJob(3, { moment: "start" }));
await refuse("a chapter's job with the moment cover", base(3, { chapter_id: one, moment: "cover" }));
await refuse("both a chapter and a story", coverJob(3, { chapter_id: one }));
await refuse("neither a chapter nor a story", base(3, { moment: "start" }));
await call("POST", "/api/picture-jobs", coverJob(4));

// ---- listing ----
r = await call("GET", `/api/picture-jobs?cover=${story}`);
ok(r.status === 200 && r.json.jobs.map((j) => j.prompt_id).join() === "cover-p4,cover-p1", "?cover lists the story's cover jobs, newest first");
r = await call("GET", `/api/picture-jobs?story=${story}`);
ok(r.json.jobs.length === 3, "the story's list has its cover jobs and its chapters'");
r = await call("GET", `/api/picture-jobs?story=${story}&chapters=1`);
ok(r.json.jobs.length === 1 && r.json.jobs[0].chapter_id === one, "chapters=1 leaves the cover's jobs out");
r = await call("GET", `/api/picture-jobs?story=${story}&not_chapter=nope`);
ok(r.json.jobs.length === 1 && r.json.jobs[0].chapter_id === one, "leaving out a chapter (as Other chapters does) leaves the cover's out too");
ok((await call("GET", `/api/picture-jobs?cover=${story}&chapter=${one}`)).status === 400, "cover can't be asked for with chapter");
const unseen = (await call("POST", "/api/picture-jobs", coverJob(5, { unseen: true }))).json;
ok((await call("GET", "/api/picture-jobs?unseen=1")).json.jobs.some((j) => j.id === unseen.id), "a cover job finished while its page wasn't open is listed as unseen");
await call("POST", "/api/picture-jobs/seen", { ids: [unseen.id] });

// ---- saving a picture as the cover ----
const marksOf = async (id) => (await call("GET", `/api/picture-jobs?cover=${story}`)).json.jobs.find((j) => j.id === id).marks;
r = await putCover(story, `?job=${first.id}&index=1`);
ok(r.status === 200 && typeof (await r.json()).cover_version === "number", "a cover picture can be saved with the job that made it");
ok((await marksOf(first.id))[1] === "pinned", "…and is pinned");
await call("PUT", `/api/picture-jobs/${first.id}/mark`, { index: 1, mark: "rejected" });
await putCover(story, `?job=${first.id}&index=1`);
ok((await marksOf(first.id))[1] === "pinned", "…also one that was trashed");
ok((await putCover(story)).status === 200 && (await marksOf(first.id))[1] === "pinned", "replacing it with an upload doesn't unpin it");
ok((await putCover(story, "?job=nope&index=0")).status === 200, "a job id that isn't known doesn't stop the cover being saved");
ok((await fetch(`${B}/api/stories/${story}/cover`, { method: "DELETE" })).status === 200, "the cover can still be removed");

// ---- the cover page's prompt boxes ----
r = await call("GET", `/api/stories/${story}/cover-draft`);
ok(r.status === 200 && r.json.draft === null, "a story starts with no saved cover prompt");
r = await call("PUT", `/api/stories/${story}/cover-draft`, { prompt: "a “lighthouse”", negative: "blur", scene: "sc", direction: "dir", source: "path", path_chapter_id: one });
ok(r.status === 200, "the cover's prompt boxes can be saved");
r = await call("GET", `/api/stories/${story}/cover-draft`);
ok(JSON.stringify(r.json.draft) === JSON.stringify({ prompt: "a “lighthouse”", negative: "blur", scene: "sc", direction: "dir", source: "path", path_chapter_id: one, refs: [] }), "…and come back as saved, with no references");
await call("PUT", `/api/stories/${story}/cover-draft`, { prompt: "p", refs: [{ source: "saved:abc:cover", label: "Cover", role: "style", weight: 0.8 }] });
r = await call("GET", `/api/stories/${story}/cover-draft`);
ok(JSON.stringify(r.json.draft.refs) === JSON.stringify([{ source: "saved:abc:cover", label: "Cover", role: "style", weight: 0.8 }]), "a cover's references are kept with its boxes");
ok((await call("PUT", `/api/stories/${story}/cover-draft`, { refs: Array.from({ length: 5 }, () => ({ source: "s", label: "l", role: "item", weight: 0.5 })) })).status === 400, "…at most four");
await call("PUT", `/api/stories/${story}/cover-draft`, { prompt: "again" });
r = await call("GET", `/api/stories/${story}/cover-draft`);
ok(r.json.draft.prompt === "again" && r.json.draft.negative === "" && r.json.draft.source === "premise" && r.json.draft.path_chapter_id === null, "a missing field is saved empty, and the source goes back to the premise");
ok((await call("PUT", `/api/stories/${story}/cover-draft`, { source: "elsewhere" })).status === 400, "an unknown source is refused");
ok((await call("PUT", `/api/stories/${story}/cover-draft`, { prompt: "x".repeat(20001) })).status === 400, "…as is a prompt over 20,000 characters");
ok((await call("PUT", "/api/stories/nope/cover-draft", { prompt: "x" })).status === 404, "…and a story that doesn't exist");

// ---- the cover's drawing preset ----
r = await call("GET", `/api/stories/${story}/cover-preset`);
ok(r.status === 200 && r.json.draw_preset === null, "the cover follows the story's drawing preset until one is chosen");
r = await call("PUT", `/api/stories/${story}/cover-preset`, { draw_preset: "anime" });
ok(r.status === 200 && (await call("GET", `/api/stories/${story}/cover-preset`)).json.draw_preset === "anime", "the cover can choose its own preset");
ok((await call("GET", `/api/stories/${story}/cover-draft`)).json.draft.prompt === "again", "…which leaves its prompt boxes alone");
await call("PUT", `/api/stories/${story}/cover-draft`, { prompt: "once more" });
ok((await call("GET", `/api/stories/${story}/cover-preset`)).json.draw_preset === "anime", "…and saving the boxes leaves the preset alone");
await call("PUT", `/api/stories/${story}/cover-preset`, { draw_preset: null });
ok((await call("GET", `/api/stories/${story}/cover-preset`)).json.draw_preset === null, "null goes back to the story's");
ok((await call("PUT", "/api/stories/nope/cover-preset", { draw_preset: "x" })).status === 404, "a story that doesn't exist has no cover preset");
