import { nextActions, type ReadyPicture } from "../../src/lib/workQueue/schedule.ts";

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
