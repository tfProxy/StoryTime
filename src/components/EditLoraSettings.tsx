"use client";

import { EDIT_MODELS } from "@/lib/comfy/editModels";
import { MAX_EDIT_LORAS, type ComfySettings, type EditLoraSetting } from "@/lib/settingsSchema";
import { useEditModels } from "./useEditModels";

const base = (f: string) => f.split(/[\\/]/).pop()!;

/**
 * The LoRA stack of each edit model, in Settings: LoRAs from ComfyUI's `loras` folder, each with a
 * strength and an on/off box (also on the Illustrate page's Edit tab). They apply in order, after Qwen's
 * Lightning LoRA when Fast is on.
 */
export default function EditLoraSettings({ comfy, onChange }: { comfy: ComfySettings; onChange: (patch: Partial<ComfySettings>) => void }) {
  const models = useEditModels(comfy.url);
  const available = models.state === "done" ? models.loras : [];

  const setStack = (id: string, stack: EditLoraSetting[]) => onChange({ editLoras: { ...comfy.editLoras, [id]: stack } });

  return (
    <div className="edit-loras" id="edit-loras">
      <h3>LoRAs for edits</h3>
      <p className="meta" style={{ margin: 0 }}>
        Each edit model can apply LoRAs from ComfyUI&apos;s <code>models/loras</code> folder, such as a character or a style made
        for that model. They apply in this order, each at its strength (1 is full; lower is weaker, and below 0 works
        against it). Switch them on or off here or on the Edit tab.
      </p>
      {!comfy.url ? (
        <p className="meta" style={{ margin: 0 }}>Add the ComfyUI address first.</p>
      ) : models.state === "checking" ? (
        <p className="meta" style={{ margin: 0 }}>Asking ComfyUI for its LoRAs…</p>
      ) : models.state === "error" ? (
        <p className="error" style={{ margin: 0 }} title={models.message}>
          Couldn&apos;t list ComfyUI&apos;s LoRAs. Test connection above says why.
        </p>
      ) : (
        available.length === 0 && (
          <p className="notice" style={{ margin: 0 }}>
            ComfyUI lists no LoRAs. Put LoRA files in <code>ComfyUI/models/loras</code> and restart ComfyUI.
          </p>
        )
      )}
      {EDIT_MODELS.map((model) => {
        const stack = comfy.editLoras[model.id] ?? [];
        const change = (i: number, patch: Partial<EditLoraSetting>) => setStack(model.id, stack.map((l, j) => (j === i ? { ...l, ...patch } : l)));
        return (
          <div key={model.id} className="edit-lora-model" role="group" aria-label={`LoRAs for ${model.name}`}>
            <p style={{ margin: 0 }}>
              <strong>{model.name}</strong> {stack.length === 0 && <span className="meta">· none</span>}
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
                    onClick={() => setStack(model.id, [...stack.slice(0, i - 1), l, stack[i - 1], ...stack.slice(i + 1)])}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remove ${base(l.name) || "this LoRA"}`}
                    title="Take it out of the stack"
                    onClick={() => setStack(model.id, stack.filter((_, j) => j !== i))}
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
                title={stack.length >= MAX_EDIT_LORAS ? `At most ${MAX_EDIT_LORAS} LoRAs` : undefined}
                onClick={() => setStack(model.id, [...stack, { name: available[0], strength: 1, on: true }])}
              >
                Add LoRA for {model.name}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
