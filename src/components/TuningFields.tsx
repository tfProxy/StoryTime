"use client";

import { TUNING_LIMITS } from "@/lib/settingsSchema";
import NumberInput from "./NumberInput";

// Used when ComfyUI can't be asked for its own lists. These are names its KSampler has had for a long time.
const COMMON_SAMPLERS = ["euler", "euler_ancestral", "heun", "dpm_2", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "dpmpp_sde", "ddim", "uni_pc", "res_multistep", "lcm"];
const COMMON_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "beta", "ddim_uniform"];

export type Tuning = { steps: number; cfg: number; sampler: string; scheduler: string; shift?: number; guidance?: number };
type NumberKey = "steps" | "cfg" | "shift" | "guidance";

const LABELS: Record<NumberKey, { label: string; hint: string }> = {
  steps: { label: "Steps", hint: "More is slower and usually a little cleaner." },
  cfg: { label: "CFG", hint: "How strongly the prompt or instruction is followed; too high looks burnt." },
  shift: { label: "Shift", hint: "Higher spends more of the steps on the big shapes; lower on detail." },
  guidance: { label: "Guidance", hint: "How closely the instruction is followed." },
};

/** A number setting, kept within its limits, with its default beside it. */
function NumberField({ k, value, def, onChange }: { k: NumberKey; value: number; def: number; onChange: (v: number) => void }) {
  const lim = TUNING_LIMITS[k];
  return (
    <label className="tuning-field" title={LABELS[k].hint}>
      <span>
        {LABELS[k].label} <small>default {def}</small>
      </span>
      <NumberInput
        min={lim.min}
        max={lim.max}
        step={lim.step}
        integer={k === "steps"}
        value={value}
        onChange={(v) => v !== null && onChange(v)}
      />
    </label>
  );
}

/** A choice from ComfyUI's list (or a common one when ComfyUI can't be asked), always offering the current one. */
function ChoiceField({ label, value, def, choices, onChange }: { label: string; value: string; def: string; choices: string[]; onChange: (v: string) => void }) {
  const list = [...new Set([value, def, ...choices])];
  return (
    <label className="tuning-field">
      <span>
        {label} <small>default {def}</small>
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A model's sampler settings in Settings: steps, CFG, sampler, scheduler, and the extra ones the model has
 * (`shift`, `guidance`). `value` is what it runs with now; changes go to `onChange`, and Reset clears them.
 */
export default function TuningFields({
  value,
  defaults,
  changed,
  samplers,
  schedulers,
  onChange,
  onReset,
  children,
}: {
  value: Tuning;
  defaults: Tuning;
  /** Whether anything differs from the defaults, so Reset has something to do. */
  changed: boolean;
  samplers: string[];
  schedulers: string[];
  onChange: (patch: Partial<Tuning>) => void;
  onReset: () => void;
  /** A note under the fields, such as what Fast changes. */
  children?: React.ReactNode;
}) {
  const extras = (["shift", "guidance"] as const).filter((k) => defaults[k] !== undefined);
  return (
    <div className="tuning">
      <div className="tuning-grid">
        <NumberField k="steps" value={value.steps} def={defaults.steps} onChange={(steps) => onChange({ steps })} />
        <NumberField k="cfg" value={value.cfg} def={defaults.cfg} onChange={(cfg) => onChange({ cfg })} />
        <ChoiceField label="Sampler" value={value.sampler} def={defaults.sampler} choices={samplers.length ? samplers : COMMON_SAMPLERS} onChange={(sampler) => onChange({ sampler })} />
        <ChoiceField
          label="Scheduler"
          value={value.scheduler}
          def={defaults.scheduler}
          choices={schedulers.length ? schedulers : COMMON_SCHEDULERS}
          onChange={(scheduler) => onChange({ scheduler })}
        />
        {extras.map((k) => (
          <NumberField key={k} k={k} value={value[k] ?? defaults[k]!} def={defaults[k]!} onChange={(v) => onChange({ [k]: v })} />
        ))}
      </div>
      {children}
      <div>
        <button type="button" className="secondary" onClick={onReset} disabled={!changed}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
