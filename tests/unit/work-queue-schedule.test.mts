import { nextActions, orderHeldPictures, type ReadyPicture } from "../../src/lib/workQueue/schedule.ts";

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
