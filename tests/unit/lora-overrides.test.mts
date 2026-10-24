import { applyLoraOverrides, hasLoraOverrides, resetLoraOverrides, setLoraOverride, type LoraOverrides } from "../../src/lib/comfy/loraOverrides.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const stack = [
  { name: "a.safetensors", strength: 1, on: true },
  { name: "b.safetensors", strength: 0.5, on: false },
];

ok(applyLoraOverrides(stack, {}, "p") === stack, "no overrides gives the same stack");

let o: LoraOverrides = setLoraOverride({}, "p", stack, 0, { on: false });
let eff = applyLoraOverrides(stack, o, "p");
ok(eff[0].on === false && eff[0].strength === 1 && eff[1].on === false, "switching one off changes only that LoRA");
ok(stack[0].on === true, "the preset's own stack is not changed");
ok(applyLoraOverrides(stack, o, "other") === stack, "another preset is not affected");

o = setLoraOverride(o, "p", stack, 0, { strength: 0.7 });
eff = applyLoraOverrides(stack, o, "p");
ok(eff[0].on === false && eff[0].strength === 0.7, "on and strength overrides combine");

o = setLoraOverride(o, "p", stack, 0, { on: true });
ok(o.p["0"].on === undefined && o.p["0"].strength === 0.7, "putting a field back to the preset's value drops it");
o = setLoraOverride(o, "p", stack, 0, { strength: 1 });
ok(o.p === undefined && !hasLoraOverrides(stack, o, "p"), "an override with nothing left is removed with its preset");

ok(setLoraOverride({}, "p", stack, 5, { on: false }) !== undefined && Object.keys(setLoraOverride({}, "p", stack, 5, { on: false })).length === 0, "an index outside the stack is ignored");

// A stale override (the LoRA at that place is another file now) is ignored.
const stale: LoraOverrides = { p: { "0": { name: "old.safetensors", on: false }, "1": { name: "b.safetensors", strength: 2 } } };
eff = applyLoraOverrides(stack, stale, "p");
ok(eff[0].on === true && eff[1].strength === 2, "an override whose file name no longer matches is ignored");
ok(hasLoraOverrides(stack, stale, "p"), "the matching one still counts");
ok(hasLoraOverrides(stack, { p: { "0": { name: "old.safetensors", on: false } } }, "p") === false, "only stale overrides do not count");
const cleaned = setLoraOverride(stale, "p", stack, 1, { on: true });
ok(cleaned.p["0"] === undefined && cleaned.p["1"].strength === 2, "setting another LoRA drops stale overrides");

ok(resetLoraOverrides({ p: { "0": { name: "a.safetensors", on: false } }, q: { "0": { name: "z", on: false } } }, "p").p === undefined, "reset removes the preset's overrides");
ok(resetLoraOverrides({ q: { "0": { name: "z", on: false } } }, "p").q !== undefined, "reset keeps the others");
