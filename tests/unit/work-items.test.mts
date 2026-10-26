// The work queue's items in SQLite: create, list, update (merging and checking data), delete.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-items-"));
process.env.STORYTIME_DB = path.join(dir, "items.db");
const { db } = await import("../../src/lib/db.ts");
const { createItem, deleteItem, getItem, KEEP_ENDED_MS, listItems, updateItem } = await import("../../src/lib/worker/items.ts");

const refused = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const picture = (extra: Record<string, unknown> = {}) => ({
  target: { kind: "chapter" as const, storyId: "s1", chapterId: "c1" },
  spec: { prompt: "a fox" },
  count: 2,
  view: { label: "Header" },
  ...extra,
});

try {
  db();
  // Create and read back.
  const a = createItem({ key: "job-a", type: "picture", state: "gathering", data: picture() }, 1000);
  ok(a.key === "job-a" && a.type === "picture" && a.state === "gathering", "a picture item is created");
  ok(a.targetKey === "chapter:c1", "a picture item is found by its target key");
  ok(a.data.count === 2 && a.data.spec.prompt === "a fox", "its data comes back");
  ok(a.createdAt === 1000 && a.updatedAt === 1000 && a.readyAt === null && a.endedAt === null && a.moved === false, "its times and flags start empty");
  const cover = createItem({ key: "job-b", type: "picture", state: "waiting", readyAt: 1500, data: picture({ target: { kind: "cover", storyId: "s1" } }) }, 2000);
  ok(cover.targetKey === "cover:s1" && cover.readyAt === 1500, "a cover item has its own target key and a ready time");
  const run = createItem({
    key: "run:r1", type: "run", state: "waiting",
    data: { runId: "r1", storyId: "s1", storyTitle: "Tale", startChapterId: null, startTitle: "Opening", mode: "fill", done: 0, total: 3 },
  }, 3000);
  ok(run.type === "run" && run.targetKey === null && run.data.total === 3, "a run item has no target key");
  createItem({ key: "gen:fill:x", type: "generate", state: "waiting", data: { draftKey: "fill:x", href: "/c/x", label: "Fill", request: { key: "fill:x" } } }, 4000);

  // Bad data and duplicate keys are refused, and leave nothing behind.
  ok(refused(() => createItem({ key: "bad", type: "picture", state: "waiting", data: picture({ count: 0 }) })), "a picture with no pictures to make is refused");
  ok(refused(() => createItem({ key: "bad2", type: "picture", state: "waiting", data: { spec: {}, count: 1, view: {} } as never })), "a picture without a target is refused");
  ok(refused(() => createItem({ key: "bad3", type: "run", state: "waiting", data: { runId: "r" } as never })), "a run without its fields is refused");
  ok(refused(() => createItem({ key: "job-a", type: "picture", state: "waiting", data: picture() })), "a key already in use is refused");
  ok(getItem("bad") === null && getItem("bad2") === null && getItem("bad3") === null, "refused items are not stored");

  // List: oldest first.
  ok(listItems(5000).map((i) => i.key).join() === "job-a,job-b,run:r1,gen:fill:x", "items are listed oldest first");

  // Update: merge data, set times, check the result.
  const u = updateItem("job-a", { state: "waiting", readyAt: 1200, data: { promptId: "p1", message: "hello" } }, 6000);
  ok(u?.state === "waiting" && u.readyAt === 1200 && u.updatedAt === 6000, "state, ready time and update time change");
  ok(u?.type === "picture" && u.data.promptId === "p1" && u.data.message === "hello" && u.data.count === 2, "data is merged into what was there");
  const cleared = updateItem("job-a", { data: { message: undefined } }, 6100);
  ok(cleared?.type === "picture" && !("message" in cleared.data) && cleared.data.promptId === "p1", "a field set to undefined is removed");
  ok(refused(() => updateItem("job-a", { data: { count: -1 } })) && getItem("job-a")?.updatedAt === 6100, "data that no longer fits is refused and nothing changes");
  ok(updateItem("nope", { state: "failed" }) === null, "updating a missing item gives null");
  ok(updateItem("job-b", { moved: true }, 6200)?.moved === true, "an item can be marked moved");
  ok(updateItem("job-b", { data: { progress: { stage: "running", value: 1, max: 4 } } }, 6300)?.moved === true, "…and stays moved when only its data changes");

  // Ending an item sets when, once.
  const ended = updateItem("job-a", { state: "done", data: { pictures: [{ id: 1 }] } }, 7000);
  ok(ended?.endedAt === 7000, "finishing an item sets when it ended");
  ok(updateItem("job-a", { data: { unseen: true } }, 8000)?.endedAt === 7000, "…and a later change does not move it");
  ok(updateItem("job-a", { state: "waiting" }, 9000)?.endedAt === null, "an item that starts again has not ended");

  // Old finished items are left out of the list.
  updateItem("job-b", { state: "failed", data: { message: "no" } }, 10_000);
  const now = 10_000 + KEEP_ENDED_MS + 1;
  const keys = listItems(now).map((i) => i.key);
  ok(!keys.includes("job-b") && keys.includes("job-a") && keys.includes("run:r1"), "a failed item is left out of the list after a week, others stay");
  ok(listItems(10_000 + KEEP_ENDED_MS - 1).some((i) => i.key === "job-b"), "…and still shown before then");

  // Delete.
  ok(deleteItem("run:r1") === true && getItem("run:r1") === null, "an item is deleted");
  ok(deleteItem("run:r1") === false, "deleting a missing item says so");
} finally {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
}
