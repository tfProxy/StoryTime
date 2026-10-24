// Per-page changes to a preset's LoRAs (switched off, or a different strength) that never touch the preset
// in Settings. Kept by preset id, then by the LoRA's place in the preset's stack; each also names the file,
// so an override whose LoRA was changed or moved in Settings is ignored rather than applied to the wrong one.
import type { LoraSetting } from "./presets";

/** One LoRA's changes: `name` is the file it was made for, and only the fields that differ from the preset are set. */
export type LoraOverride = { name: string; on?: boolean; strength?: number };

/** Preset id -> stack index (as text, since it is kept as JSON) -> override. */
export type LoraOverrides = Record<string, Record<string, LoraOverride>>;

/** The overrides of one preset that still match its stack. */
function matching(all: LoraOverrides, presetId: string, stack: LoraSetting[]): [number, LoraOverride][] {
  const mine = all[presetId];
  if (!mine) return [];
  const found: [number, LoraOverride][] = [];
  for (const [key, o] of Object.entries(mine)) {
    const i = Number(key);
    if (Number.isInteger(i) && stack[i] && stack[i].name === o.name) found.push([i, o]);
  }
  return found;
}

/** The preset's stack with its overrides applied (the same list when there are none). */
export function applyLoraOverrides(stack: LoraSetting[], all: LoraOverrides, presetId: string): LoraSetting[] {
  const found = matching(all, presetId, stack);
  if (found.length === 0) return stack;
  const next = stack.slice();
  for (const [i, o] of found) next[i] = { ...stack[i], ...(o.on !== undefined && { on: o.on }), ...(o.strength !== undefined && { strength: o.strength }) };
  return next;
}

/** Whether the preset has an override that still applies to its stack. */
export const hasLoraOverrides = (stack: LoraSetting[], all: LoraOverrides, presetId: string) => matching(all, presetId, stack).length > 0;

/**
 * Sets `patch` on the LoRA at `index` of the preset's stack. A field put back to the preset's own value is
 * dropped, and so is an override left with nothing in it. Overrides that no longer match the stack are dropped too.
 */
export function setLoraOverride(all: LoraOverrides, presetId: string, stack: LoraSetting[], index: number, patch: { on?: boolean; strength?: number }): LoraOverrides {
  const base = stack[index];
  if (!base) return all;
  const mine: Record<string, LoraOverride> = {};
  for (const [i, o] of matching(all, presetId, stack)) mine[String(i)] = o;
  const merged = { ...(mine[String(index)] ?? { name: base.name }), ...patch };
  const next: LoraOverride = { name: base.name };
  if (merged.on !== undefined && merged.on !== base.on) next.on = merged.on;
  if (merged.strength !== undefined && merged.strength !== base.strength) next.strength = merged.strength;
  if (next.on === undefined && next.strength === undefined) delete mine[String(index)];
  else mine[String(index)] = next;
  const rest = { ...all };
  if (Object.keys(mine).length === 0) delete rest[presetId];
  else rest[presetId] = mine;
  return rest;
}

/** The overrides without the preset's. */
export function resetLoraOverrides(all: LoraOverrides, presetId: string): LoraOverrides {
  if (!all[presetId]) return all;
  const rest = { ...all };
  delete rest[presetId];
  return rest;
}
