"use client";

import { MAX_LORAS, type LoraSetting } from "@/lib/comfy/presets";
import NumberInput from "./NumberInput";

const base = (f: string) => f.split(/[\\/]/).pop()!;

/**
 * A preset's LoRA stack, in its card in Settings: LoRAs from ComfyUI's `loras` folder (`available`), each
 * with a strength and an on/off box (also on the Illustrate page). They apply in order. `label` names the
 * preset, for the group; `madeFor` says what the LoRAs must be made for (a model, or the checkpoint).
 */
export default function LoraStack({
  label,
  madeFor,
  stack,
  available,
  onChange,
  children,
}: {
  label: string;
  madeFor: string;
  stack: LoraSetting[];
  available: string[];
  onChange: (stack: LoraSetting[]) => void;
  /** A note under the explanation, such as where the speed-up goes. */
  children?: React.ReactNode;
}) {
  const change = (i: number, patch: Partial<LoraSetting>) => onChange(stack.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="edit-lora-model" role="group" aria-label={`LoRAs for ${label}`}>
      <p style={{ margin: 0 }}>
        <strong>LoRAs</strong> {stack.length === 0 && <span className="meta">· none</span>}
      </p>
      <p className="meta" style={{ margin: 0 }}>
        Such as a character or a style made for {madeFor}, from ComfyUI&apos;s <code>models/loras</code> folder. They apply in
        this order, each at its strength (1 is full; lower is weaker, and below 0 works against it).
      </p>
      {children}
      {stack.map((l, i) => {
        const known = available.includes(l.name);
        return (
          <div key={i} className="edit-lora-row">
            <input type="checkbox" aria-label={`Use ${base(l.name) || "this LoRA"}`} checked={l.on} onChange={(e) => change(i, { on: e.target.checked })} />
            <select aria-label="LoRA file" value={l.name} onChange={(e) => change(i, { name: e.target.value })}>
              {!known && <option value={l.name}>{l.name ? `${l.name} (not in ComfyUI)` : "Choose a LoRA"}</option>}
              {available.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <NumberInput
              aria-label={`Strength of ${base(l.name) || "this LoRA"}`}
              title="Strength: 1 is full, lower is weaker"
              min={-4}
              max={4}
              step={0.05}
              value={l.strength}
              onChange={(v) => v !== null && change(i, { strength: v })}
            />
            <button
              type="button"
              className="secondary"
              aria-label={`Move ${base(l.name) || "this LoRA"} up`}
              title="Apply it earlier"
              disabled={i === 0}
              onClick={() => onChange([...stack.slice(0, i - 1), l, stack[i - 1], ...stack.slice(i + 1)])}
            >
              ↑
            </button>
            <button
              type="button"
              className="secondary"
              aria-label={`Remove ${base(l.name) || "this LoRA"}`}
              title="Take it out of the stack"
              onClick={() => onChange(stack.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="secondary"
          disabled={available.length === 0 || stack.length >= MAX_LORAS}
          title={available.length === 0 ? "ComfyUI lists no LoRAs" : stack.length >= MAX_LORAS ? `At most ${MAX_LORAS} LoRAs` : undefined}
          onClick={() => onChange([...stack, { name: available[0], strength: 1, on: true }])}
        >
          Add LoRA to {label}
        </button>
      </div>
    </div>
  );
}
