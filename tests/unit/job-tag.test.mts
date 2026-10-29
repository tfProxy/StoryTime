import { readTag } from "../../src/lib/comfy/jobTag.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const job = { prompt: "a lamp", negative: "", checkpoint: "a.safetensors", width: 1024, height: 1024, seed: 5, count: 2, moment: "start" };
const tag = { chapterId: "c1", storyId: "s1", clientId: "storytime-x", job };

ok(readTag({ storytime: tag })?.job.count === 2 && readTag({ storytime: tag })?.clientId === "storytime-x", "a full tag is read back");
ok(readTag({ storytime: { ...tag, job: { ...job, source: "comfy:a.png", denoise: null, instruction: "remove it", edit_model: "qwen-image-edit" } } })?.job.instruction === "remove it", "an edit's source, instruction and model are kept");
ok(readTag({ storytime: { chapterId: "c1", storyId: "s1" } }) === null, "a tag from before jobs carried their settings is not enough to record a job");
ok(readTag({}) === null && readTag(null) === null && readTag("x") === null, "a job that isn't StoryTime's has no tag");
ok(readTag({ storytime: { ...tag, job: { ...job, moment: "late" } } }) === null, "an unknown moment is refused");
const cover = { ...tag, chapterId: null, job: { ...job, moment: "cover" } };
ok(readTag({ storytime: cover })?.chapterId === null && readTag({ storytime: cover })?.job.moment === "cover", "a cover job has no chapter and the moment cover");
ok(readTag({ storytime: { ...cover, job: { ...job, moment: "start" } } }) === null, "a job with no chapter must be a cover");
ok(readTag({ storytime: { ...tag, job: { ...job, moment: "cover" } } }) === null, "a chapter's job can't be a cover");
ok(readTag({ storytime: { ...tag, job: { ...job, width: "1024" } } }) === null, "a size that isn't a number is refused");
ok(readTag({ storytime: { ...tag, job: { ...job, denoise: "high" } } }) === null, "a strength that isn't a number is refused");
