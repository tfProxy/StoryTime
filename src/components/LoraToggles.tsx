"use client";

import Link from "next/link";
import NumberInput from "./NumberInput";
import type { LoraSetting } from "@/lib/comfy/presets";

/**
 * A preset's LoRAs: an on/off box and a strength for each. `stack` is the preset's stack with the changes
 * applied (`applyLoraOverrides`); a change here is only for this page (or Refine session), kept in this
 * browser, and never changes the preset in Settings (that is the Change link). `onChange` gets the
 * LoRA's place in the stack, `changed` says whether there are changes, and `onReset` drops them.
 * `available` is what ComfyUI lists, or null when that isn't known yet.
 */
export default function LoraToggles({
  stack,
  available,
  href,
  changed,
  onChange,
  onReset,
}: {
  stack: LoraSetting[];
  available: string[] | null;
  href?: string;
  changed: boolean;
  onChange: (index: number, patch: { on?: boolean; strength?: number }) => void;
  onReset: () => void;
}) {
  return (
    <div className="edit-lora-toggles" role="group" aria-label="LoRAs">
      <span className="meta">LoRAs:</span>
      {stack.map((l, i) => {
        const name = (l.name.split(/[\\/]/).pop() ?? l.name).replace(/\.safetensors$/i, "");
        const gone = available !== null && !available.includes(l.name);
        return (
          <span key={i} className="inline-label" title={gone ? `ComfyUI doesn't list ${l.name}, so it isn't used` : l.name}>
            <label className="inline-label">
              <input type="checkbox" checked={l.on} onChange={(e) => onChange(i, { on: e.target.checked })} />
              <span className={gone ? "error" : undefined}>
                {name}
                {gone && " – missing"}
              </span>
            </label>
            <NumberInput
              aria-label={`Strength of ${name}`}
              title="Strength: 1 is full, lower is weaker (only for this page; the preset keeps its own)"
              min={-4}
              max={4}
              step={0.05}
              value={l.strength}
              onChange={(v) => v !== null && onChange(i, { strength: v })}
              style={{ width: "5rem" }}
            />
          </span>
        );
      })}
      {changed && (
        <button type="button" className="secondary" onClick={onReset} title="Go back to the on/off and strengths the preset has in Settings">
          Reset LoRAs to preset
        </button>
      )}
      {href && (
        <Link href={href} className="meta">
          Change
        </Link>
      )}
    </div>
  );
}
