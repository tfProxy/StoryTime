// The log of picture jobs made on the ComfyUI machine: recording a finished job, listing and paging it,
// how a saved picture keeps the prompt of the job that made it, and what export and import do with that.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const exportOf = async (id) => (await fetch(`${B}/api/stories/${id}/export?format=json`)).json();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const put = (chapter, slot, query = "") => fetch(`${B}/api/chapters/${chapter}/images/${slot}${query}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });

const made = await call("POST", "/api/stories", { title: "Jobs", chapter: { title: "One", body: "first", choices: ["Next"] } });
const story = made.json.story_id, one = made.json.chapter_id;
const two = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${one}`)).json.choices[0].id, title: "Two", body: "second" })).json.chapter_id;

const job = (chapter_id, n, extra = {}) => ({
  chapter_id, prompt_id: `p${n}`, prompt: `prompt ${n}`, negative: `neg ${n}`, checkpoint: "sdxl.safetensors",
  width: 1344, height: 768, seed: 100 + n, count: 2, moment: "start",
  images: [0, 1].map((i) => ({ filename: `StoryTime_${n}_${i}.png`, subfolder: `StoryTime/${story}/${chapter_id}`, type: "output" })),
  ...extra,
});

// ---- recording ----
let r = await call("POST", "/api/picture-jobs", job(one, 1));
const first = r.json;
ok(r.status === 201 && typeof first.id === "string" && first.story_id === story && first.chapter_id === one, "a finished job is recorded, with the chapter's story filled in");
ok(first.prompt === "prompt 1" && first.negative === "neg 1" && first.checkpoint === "sdxl.safetensors" && first.width === 1344 && first.height === 768 && first.seed === 101 && first.count === 2 && first.moment === "start", "…with its prompt and settings");
ok(first.images.length === 2 && first.images[1].filename === "StoryTime_1_1.png" && first.images[0].subfolder === `StoryTime/${story}/${one}` && first.images[0].type === "output", "…and where ComfyUI put the pictures");
ok(first.source === null && first.denoise === null && typeof first.created_at === "number" && !("seq" in first), "…with no start picture, a time, and no database bookkeeping");

r = await call("POST", "/api/picture-jobs", { ...job(one, 1), prompt: "something else" });
ok(r.status === 201 && r.json.id === first.id && r.json.prompt === "prompt 1", "recording the same ComfyUI job again returns the first record");
r = await call("POST", "/api/picture-jobs", job(two, 1));
ok(r.status === 201 && r.json.id !== first.id && r.json.story_id === story, "the same job id on another chapter is a separate record");
r = await call("POST", "/api/picture-jobs", job(one, 2, { moment: undefined, source: "StoryTime_1_0.png", denoise: 0.5, seed: 2 ** 48 + 7, negative: undefined }));
ok(r.status === 201 && r.json.moment === null && r.json.source === "StoryTime_1_0.png" && r.json.denoise === 0.5 && r.json.seed === 2 ** 48 + 7 && r.json.negative === "", "an optional moment is null, a start picture and strength are kept, a big seed is exact and a missing negative prompt is empty");

ok((await call("POST", "/api/picture-jobs", job("nope", 3))).status === 404, "a chapter that doesn't exist can't have jobs");
const refuse = async (what, patch) => {
  const x = await call("POST", "/api/picture-jobs", job(one, 9, patch));
  ok(x.status === 400 && x.json?.error, `rejected: ${what} (${x.json?.error})`);
};
await refuse("no prompt", { prompt: "" });
await refuse("a prompt that isn't text", { prompt: 5 });
await refuse("no pictures", { images: [] });
await refuse("a picture without a file name", { images: [{ filename: "", subfolder: "", type: "output" }] });
await refuse("a negative seed", { seed: -1 });
await refuse("a seed with a fraction", { seed: 1.5 });
await refuse("zero width", { width: 0 });
await refuse("no pictures made", { count: 0 });
await refuse("an unknown moment", { moment: "middle" });
await refuse("a strength over 1", { denoise: 1.5 });
await refuse("a prompt over 20,000 characters", { prompt: "x".repeat(20001) });
const notJson = await fetch(`${B}/api/picture-jobs`, { method: "POST", body: "{nope" });
ok(notJson.status === 400, "a body that isn't JSON is rejected");
ok((await call("GET", `/api/picture-jobs?chapter=${one}`)).json.jobs.length === 2, "…and nothing was recorded by the rejected ones");

// ---- listing and paging ----
for (let n = 10; n < 15; n++) await call("POST", "/api/picture-jobs", job(n % 2 ? one : two, n));
r = await call("GET", `/api/picture-jobs?story=${story}`);
ok(r.status === 200 && r.json.jobs.length === 8 && r.json.next === null, "a story's log lists every job once");
ok(r.json.jobs.map((j) => j.prompt_id).join() === "p14,p13,p12,p11,p10,p2,p1,p1", "…newest first");
ok(r.json.jobs.every((j) => !("seq" in j)) && r.json.jobs[0].images.length === 2, "…each with its pictures");
r = await call("GET", `/api/picture-jobs?chapter=${two}`);
ok(r.json.jobs.map((j) => j.prompt_id).join() === "p14,p12,p10,p1" && r.json.jobs.every((j) => j.chapter_id === two), "a chapter's log lists only that chapter's jobs");

const seen = [];
let cursor = null, pages = 0;
do {
  const page = await call("GET", `/api/picture-jobs?story=${story}&limit=3${cursor ? `&before=${cursor}` : ""}`);
  ok(page.status === 200 && page.json.jobs.length <= 3, `page ${pages + 1} has at most 3 jobs`);
  seen.push(...page.json.jobs.map((j) => j.id));
  cursor = page.json.next;
  pages++;
} while (cursor && pages < 10);
ok(pages === 3 && seen.length === 8 && new Set(seen).size === 8, "paging with limit=3 and the next cursor reaches all 8 jobs once, in 3 pages");
ok(seen.join() === (await call("GET", `/api/picture-jobs?story=${story}`)).json.jobs.map((j) => j.id).join(), "…in the same order as one big page");
r = await call("GET", `/api/picture-jobs?story=${story}&limit=8`);
ok(r.json.jobs.length === 8 && r.json.next === null, "a page that ends exactly at the last job has no next cursor");
r = await call("GET", "/api/picture-jobs?story=nope");
ok(r.status === 200 && r.json.jobs.length === 0 && r.json.next === null, "an unknown story has an empty log");

for (const [what, q] of [["neither story nor chapter", ""], ["both", `?story=${story}&chapter=${one}`], ["limit 0", `?story=${story}&limit=0`], ["limit 201", `?story=${story}&limit=201`],
  ["a limit that isn't a number", `?story=${story}&limit=lots`], ["a fractional limit", `?story=${story}&limit=2.5`], ["a cursor that isn't a number", `?story=${story}&before=old`], ["a cursor of 0", `?story=${story}&before=0`]]) {
  const x = await call("GET", `/api/picture-jobs${q}`);
  ok(x.status === 400 && x.json?.error, `listing refused: ${what}`);
}

// ---- a saved picture keeps the prompt of the job that made it ----
const jobsOne = (await call("GET", `/api/picture-jobs?chapter=${one}`)).json.jobs;
const mine = jobsOne.find((j) => j.prompt_id === "p1");
const imagesOf = async (id = story) => (await exportOf(id)).images;
ok((await put(one, "header", `?job=${mine.id}`)).status === 200, "a picture can be saved with the job that made it");
ok((await put(one, "footer")).status === 200, "…and one without");
let pics = await imagesOf();
ok(pics.find((i) => i.slot === "header").prompt === "prompt 1" && pics.find((i) => i.slot === "header").negative === "neg 1", "the export gives the saved picture its prompt and negative prompt");
ok(pics.find((i) => i.slot === "footer").prompt === null && pics.find((i) => i.slot === "footer").negative === null, "…and none to the uploaded one");
ok(!JSON.stringify(pics).includes("job_id") && !JSON.stringify(pics).includes(mine.id), "…without the job's id, which means nothing outside this database");

const other = (await call("GET", `/api/picture-jobs?chapter=${two}`)).json.jobs.find((j) => j.prompt_id === "p12");
ok((await put(one, "footer", `?job=${other.id}`)).status === 200, "a picture made for another chapter can be saved here with its job");
pics = await imagesOf();
ok(pics.find((i) => i.slot === "footer").prompt === "prompt 12" && pics.find((i) => i.slot === "footer").negative === "neg 12", "…and keeps that job's prompt");

ok((await put(one, "footer", "?job=nope")).status === 200, "a job id that isn't known doesn't stop the picture being saved");
pics = await imagesOf();
ok(pics.find((i) => i.slot === "footer").prompt === null, "…it just has no prompt");

await put(one, "footer", `?job=${mine.id}`);
await put(one, "footer");
pics = await imagesOf();
ok(pics.find((i) => i.slot === "footer").prompt === null && pics.find((i) => i.slot === "footer").negative === null, "replacing a picture with an upload clears the old prompt");

// ---- export and import ----
await put(two, "header", `?job=${mine.id}`);
const data = await exportOf(story);
r = await call("POST", "/api/stories/import", data);
ok(r.status === 201, "a story whose pictures have prompts imports");
const copy = await exportOf(r.json.story_id);
const promptsOf = (d) => d.images.map((i) => `${i.slot}:${i.prompt}:${i.negative}`).join("|");
ok(promptsOf(copy) === promptsOf(data) && promptsOf(copy).includes("header:prompt 1:neg 1"), "the copy's pictures have the same prompts");
r = await call("GET", `/api/picture-jobs?story=${r.json.story_id}`);
ok(r.json.jobs.length === 0, "the job log is not copied: the pictures belong to the ComfyUI machine");

const long = structuredClone(data); long.images[0].prompt = "x".repeat(20001);
ok((await call("POST", "/api/stories/import", long)).status === 400, "an exported prompt over 20,000 characters is rejected");
const typed = structuredClone(data); typed.images[0].prompt = 5;
ok((await call("POST", "/api/stories/import", typed)).status === 400, "…as is one that isn't text");
