import { batchUsedUp, machineNote, moveWaiting, nextActions, orderHeldPictures, schedule, waitingOrder, type Holder, type ReadyPicture } from "../../src/lib/workQueue/schedule.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const job = (key: string, targetKey: string, drawPreset: string | null, readyAt: number): ReadyPicture => ({ key, targetKey, drawPreset, readyAt });

// Nothing ready, nothing to do.
ok(nextActions({ ready: [], inFlight: [] }).length === 0, "an empty state gives no actions");
ok(nextActions({ ready: [], inFlight: ["a"] }).length === 0, "nothing ready gives no actions even with jobs in flight");

// Every ready job is sent, in the order given.
const ready = [job("b", "chapter:c2", "fast", 10), job("a", "chapter:c1", null, 20), job("c", "cover:s1", "slow", 30)];
const acts = nextActions({ ready, inFlight: [] });
ok(acts.length === 3, "three ready jobs give three actions");
ok(acts.every((a) => a.kind === "sendPicture"), "every action is sendPicture");
ok(acts.map((a) => a.key).join(",") === "b,a,c", "actions follow the ready order");

// Jobs in flight don't hold ready ones back.
const busy = nextActions({ ready, inFlight: ["x", "y"] });
ok(busy.map((a) => a.key).join(",") === "b,a,c", "jobs in flight do not stop ready ones from being sent");

// Pure: the input is not changed.
const state = { ready: ready.map((r) => ({ ...r })), inFlight: ["x"] };
const before = JSON.stringify(state);
nextActions(state);
ok(JSON.stringify(state) === before, "the input is not changed");
ok(JSON.stringify(nextActions(state)) === JSON.stringify(nextActions(state)), "the same state gives the same actions");

// Grouping held pictures (D21).
const held = [
  job("a1", "chapter:a", "slow", 1),
  job("b1", "chapter:b", "fast", 2),
  job("c1", "chapter:c", "slow", 3),
  job("b2", "chapter:b", "slow", 4),
  job("d1", "chapter:d", "fast", 5),
];
const keys = (l: ReadyPicture[]) => l.map((j) => j.key).join(",");
ok(keys(orderHeldPictures(held, "fast", false)) === "a1,b1,c1,b2,d1", "grouping off keeps the ready order");
ok(keys(orderHeldPictures(held, null, true)) === "a1,b1,c1,b2,d1", "no job sent yet keeps the ready order");
ok(keys(orderHeldPictures(held, "fast", true)) === "b1,d1,a1,c1,b2", "jobs of the last-sent preset go first, then the rest in order");
ok(keys(orderHeldPictures(held, "slow", true)) === "a1,c1,b1,d1,b2", "a target's own jobs keep their order (b1 before b2), and grouping follows the preset of the job sent last");
const shuffled = [held[3], held[0], held[4], held[2], held[1]];
ok(keys(orderHeldPictures(shuffled, "slow", false)) === "a1,b1,c1,b2,d1", "held jobs are sorted by when they became ready");
const copy = JSON.stringify(held);
orderHeldPictures(held, "fast", true);
ok(JSON.stringify(held) === copy, "grouping does not change its input");
ok(orderHeldPictures([], "fast", true).length === 0, "nothing held gives nothing");

// The Queue settings: missing or broken values read as the defaults.
const { parseSettings, DEFAULT_QUEUE } = await import("../../src/lib/settingsSchema.ts");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
ok(same(parseSettings({}).queue, DEFAULT_QUEUE), "settings with no queue read as the defaults");
ok(DEFAULT_QUEUE.sharing === "turns" && DEFAULT_QUEUE.switchMinutes === 10 && DEFAULT_QUEUE.switchItems === 0 && DEFAULT_QUEUE.groupPictures, "the defaults are take turns, 10 minutes, no item limit, grouping on");
ok(same(parseSettings({ queue: { sharing: "together", switchMinutes: 30, switchItems: 5, groupPictures: false } }).queue, { sharing: "together", switchMinutes: 30, switchItems: 5, groupPictures: false }), "saved queue settings are kept");
ok(same(parseSettings({ queue: { sharing: "x", switchMinutes: 500, switchItems: -1, groupPictures: "no" } }).queue, DEFAULT_QUEUE), "broken queue values fall back to the defaults");
ok(parseSettings({ queue: { switchMinutes: 5 } }).queue.sharing === "turns", "a partly saved queue fills the rest");

// Pause: nothing new is sent.
ok(nextActions({ ready, inFlight: [], paused: true }).length === 0, "while paused nothing is sent");
ok(nextActions({ ready, inFlight: [], paused: false }).length === 3, "not paused sends as usual");

// nextActions follows the grouping and the moves.
ok(nextActions({ ready: held, inFlight: [], lastPreset: "fast", group: true }).map((a) => a.key).join() === "b1,d1,a1,c1,b2", "sending follows the grouping when it is on");
ok(nextActions({ ready: held, inFlight: [], lastPreset: "fast", group: false }).map((a) => a.key).join() === "a1,b1,c1,b2,d1", "…and the ready order when it is off");

// Moving by hand.
const order = waitingOrder(held, null, false);
const up = moveWaiting(order, "c1", "up");
ok(keys(up) === "a1,c1,b1,b2,d1", "Move up swaps with the job before it");
ok(up.every((j) => j.moved), "…and every waiting job is marked as moved");
ok(keys(moveWaiting(up, "b2", "up")) === "a1,c1,b1,b2,d1", "Move up can't pass an earlier job of the same target");
ok(keys(moveWaiting(up, "b1", "down")) === "a1,c1,b1,b2,d1", "…nor Move down past a later job of the same target");
ok(keys(moveWaiting(order, "a1", "up")) === "a1,b1,c1,b2,d1", "the first job can't move up");
ok(keys(moveWaiting(order, "b1", "down")) === "a1,c1,b1,b2,d1", "Move down swaps with the job after it");
ok(keys(moveWaiting(order, "b1", "down").filter(() => true)) === keys(moveWaiting(order, "c1", "up")), "…the same as moving its neighbour up");
ok(keys(moveWaiting(order, "d1", "down")) === "a1,b1,c1,b2,d1", "the last job can't move down");
ok(keys(moveWaiting(order, "d1", "next")) === "d1,a1,b1,c1,b2", "Do next puts the job first");
ok(keys(moveWaiting(order, "b2", "next")) === "b1,b2,a1,c1,d1", "Do next brings the target's earlier jobs along, in order");
ok(keys(moveWaiting(order, "nope", "next")) === keys(order), "an unknown job changes nothing");
const before2 = JSON.stringify(order);
moveWaiting(order, "d1", "next");
ok(JSON.stringify(order) === before2, "moving does not change its input");

// Moved jobs beat grouping and keep their order; new jobs come after them, grouped.
const manual = moveWaiting(order, "d1", "next");
const withNew = [...manual, job("e1", "chapter:e", "slow", 6), job("f1", "chapter:f", "fast", 7)];
ok(keys(waitingOrder(withNew, "fast", true)) === "d1,a1,b1,c1,b2,f1,e1", "moved jobs keep their order before the rest, which are grouped");

// ---- writing and pictures sharing the machine (D16, D18, D19) ----
const MIN = 60_000;
const pics = [job("p1", "chapter:a", "x", 1), job("p2", "chapter:b", "x", 2), job("p3", "chapter:c", "x", 3)];
const kinds = (state: Parameters<typeof schedule>[0]) => schedule(state).actions.map((a) => (a.kind === "sendPicture" ? a.key : `W:${a.id}`)).join();
const base = { ready: pics, inFlight: [] as string[], sharing: "turns" as const, switchMinutes: 10, switchItems: 0, now: 0 };

// Together: everything goes at once; one writing step at a time.
ok(kinds({ ...base, sharing: "together", writing: { waiting: ["r1", "r2"], active: false } }) === "p1,p2,p3,W:r1", "together: every picture job is sent and the first waiting run starts");
ok(kinds({ ...base, sharing: "together", writing: { waiting: ["r2"], active: true } }) === "p1,p2,p3", "together: only one writing step at a time");
ok(kinds({ ...base, ready: [], sharing: "together", writing: { waiting: ["r1"], active: true }, inFlight: ["j"] }) === "", "together: nothing new while a step runs and nothing is ready");
ok(kinds({ ...base, sharing: undefined, writing: { waiting: ["r1"], active: false } }) === "p1,p2,p3,W:r1", "without a sharing setting both go at once");
ok(kinds({ ...base, paused: true, writing: { waiting: ["r1"], active: false } }) === "", "paused: nothing starts, writing included");

// Turns: one kind at a time.
ok(kinds({ ...base, writing: { waiting: ["r1"], active: true } }) === "", "turns: while a writing step runs no picture job is sent");
ok(kinds({ ...base, inFlight: ["j"], writing: { waiting: ["r1"], active: false } }) === "p1,p2,p3", "turns: while pictures are in ComfyUI no writing step starts (and more pictures may go)");
ok(schedule({ ...base, inFlight: ["j"], writing: { waiting: ["r1"], active: false } }).holder?.kind === "pictures", "…a job found in ComfyUI counts as pictures holding the machine");
ok(kinds({ ...base, writing: { waiting: ["r1"], active: false } }) === "p1,p2,p3", "turns: idle with nothing held, pictures go first");
ok(kinds({ ...base, ready: [], writing: { waiting: ["r1", "r2"], active: false } }) === "W:r1", "turns: only writing waiting, the first run goes");
ok(kinds({ ...base, writing: { waiting: [], active: false } }) === "p1,p2,p3", "turns: only pictures waiting, they all go");

// Switching.
const writingHolds = (since: number, count: number): Holder => ({ kind: "writing", since, count });
const picturesHold = (since: number, count: number): Holder => ({ kind: "pictures", since, count });
ok(kinds({ ...base, now: 5 * MIN, holder: writingHolds(0, 3), writing: { waiting: ["r1"], active: false } }) === "W:r1", "writing keeps the machine inside its batch, pictures waiting");
ok(schedule({ ...base, now: 5 * MIN, holder: writingHolds(0, 3), writing: { waiting: ["r1"], active: false } }).holder?.count === 4, "…and counts the step it starts");
ok(kinds({ ...base, now: 10 * MIN, holder: writingHolds(0, 3), writing: { waiting: ["r1"], active: false } }) === "p1,p2,p3", "after switchMinutes the pictures take over");
const handed = schedule({ ...base, now: 10 * MIN, holder: writingHolds(0, 3), writing: { waiting: ["r1"], active: false } }).holder!;
ok(handed.kind === "pictures" && handed.since === 10 * MIN && handed.count === 3, "…and the new holder starts its own batch (time and count)");
ok(kinds({ ...base, switchItems: 2, now: MIN, holder: writingHolds(0, 2), writing: { waiting: ["r1"], active: false } }) === "p1,p2", "after switchItems writing steps the pictures take over, up to their own batch of 2 while writing waits");
ok(kinds({ ...base, ready: pics.slice(0, 1), switchItems: 2, now: MIN, holder: writingHolds(0, 2), writing: { waiting: ["r1"], active: false } }) === "p1", "…fewer if fewer are ready");
ok(kinds({ ...base, switchItems: 2, now: MIN, holder: picturesHold(0, 0), writing: { waiting: ["r1"], active: false } }) === "p1,p2", "pictures send only up to their batch while writing waits");
ok(kinds({ ...base, switchItems: 2, now: MIN, holder: picturesHold(0, 2), writing: { waiting: ["r1"], active: false } }) === "W:r1", "when the pictures' batch is used up writing takes over");
ok(kinds({ ...base, inFlight: ["j"], switchItems: 2, now: MIN, holder: picturesHold(0, 2), writing: { waiting: ["r1"], active: false } }) === "", "…the pictures in flight finish first, and no more are sent");
ok(kinds({ ...base, ready: [], now: 99 * MIN, holder: writingHolds(0, 99), writing: { waiting: ["r1"], active: false } }) === "W:r1", "a holder with a used-up batch keeps going when the other kind has nothing waiting");
ok(kinds({ ...base, now: 99 * MIN, holder: writingHolds(0, 99), writing: { waiting: [], active: false } }) === "p1,p2,p3", "…and when it has nothing waiting the other kind goes");
ok(batchUsedUp(writingHolds(0, 0), { now: 10 * MIN, switchMinutes: 10, switchItems: 0 }) && !batchUsedUp(writingHolds(0, 50), { now: MIN, switchMinutes: 10, switchItems: 0 }), "no item limit when switchItems is 0; the time limit alone works");

// Grouping when held jobs are released.
const mixed = [job("a", "chapter:a", "slow", 1), job("b", "chapter:b", "fast", 2), job("c", "chapter:c", "slow", 3)];
ok(kinds({ ...base, ready: mixed, group: true, lastPreset: "fast", writing: { waiting: ["r1"], active: false } }) === "b,a,c", "released jobs go with the last-sent preset first");
ok(kinds({ ...base, ready: mixed, group: true, lastPreset: "fast", switchItems: 1, writing: { waiting: ["r1"], active: false } }) === "b", "…and a batch limit cuts the grouped order, not the ready order");

// The input is not changed.
const frozen = { ...base, holder: writingHolds(0, 1), writing: { waiting: ["r1"], active: false } };
const snapshot = JSON.stringify(frozen);
schedule(frozen);
ok(JSON.stringify(frozen) === snapshot, "schedule does not change its input");

// The header's line.
const note = (extra: Partial<Parameters<typeof machineNote>[0]>) => machineNote({ holder: writingHolds(0, 1), sharing: "turns", switchMinutes: 20, switchItems: 0, waitingPictures: 3, waitingWriting: 0, timeText: (ms) => `t${ms / MIN}`, ...extra });
ok(note({}) === "Writing until t20, then 3 picture jobs", "the note says who has the machine, until when and what is next");
ok(note({ switchItems: 5 }) === "Writing until t20 or 4 more steps, then 3 picture jobs", "…with the item limit");
ok(note({ holder: picturesHold(0, 0), waitingPictures: 0, waitingWriting: 2 }) === "Pictures until t20, then 2 writing items", "…for pictures too");
ok(note({ waitingPictures: 0 }) === null && note({ sharing: "together" }) === null && note({ holder: null }) === null, "…and nothing when nothing waits, or not taking turns");
