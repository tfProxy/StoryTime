"use client";

import type { EditModel } from "@/lib/comfy/editModels";
import { MAX_EDIT_LORAS, type EditLoraSetting } from "@/lib/settingsSchema";

const base = (f: string) => f.split(/[\\/]/).pop()!;

/**
 * One edit model's LoRA stack, in its card in Settings: LoRAs from ComfyUI's `loras` folder (`available`),
 * each with a strength and an on/off box (also on the Illustrate page's Edit tab). They apply in order,
 * after Qwen's Lightning LoRA when Fast is on.
 */
export default function EditLoraStack({
  model,
  stack,
  available,
  onChange,
}: {
  model: EditModel;
  stack: EditLoraSetting[];
  available: string[];
  onChange: (stack: EditLoraSetting[]) => void;
}) {
  const change = (i: number, patch: Partial<EditLoraSetting>) => onChange(stack.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="edit-lora-model" role="group" aria-label={`LoRAs for ${model.name}`}>
      <p style={{ margin: 0 }}>
        <strong>LoRAs</strong> {stack.length === 0 && <span className="meta">· none</span>}
      </p>
      <p className="meta" style={{ margin: 0 }}>
        Such as a character or a style made for {model.name}, from ComfyUI&apos;s <code>models/loras</code> folder. They
        apply in this order, each at its strength (1 is full; lower is weaker, and below 0 works against it).
      </p>
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
            <input
              type="number"
              aria-label={`Strength of ${base(l.name) || "this LoRA"}`}
              title="Strength: 1 is full, lower is weaker"
              min={-4}
              max={4}
              step={0.05}
              value={l.strength}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value !== "" && Number.isFinite(v)) change(i, { strength: Math.max(-4, Math.min(4, v)) });
              }}
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
          disabled={available.length === 0 || stack.length >= MAX_EDIT_LORAS}
          title={available.length === 0 ? "ComfyUI lists no LoRAs" : stack.length >= MAX_EDIT_LORAS ? `At most ${MAX_EDIT_LORAS} LoRAs` : undefined}
          onClick={() => onChange([...stack, { name: available[0], strength: 1, on: true }])}
        >
          Add LoRA for {model.name}
        </button>
      </div>
    </div>
  );
}
