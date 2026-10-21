"use client";

import { useState } from "react";
import { TUNING_LIMITS, type ComfySettings as Comfy } from "@/lib/settingsSchema";
import { BUILTIN_SAMPLER, builtinSampler, describeWorkflow, parseWorkflow, WorkflowError, type WorkflowFit } from "@/lib/comfy/workflow";
import { checkComfy, type ComfyCheck } from "@/lib/comfy/check";
import { EDIT_MODELS, editTuning, lightningSteps, type EditModel } from "@/lib/comfy/editModels";
import AutoTextarea from "./AutoTextarea";
import EditLoraStack from "./EditLoraStack";
import TuningFields from "./TuningFields";
import { useEditModels, type EditModels } from "./useEditModels";

const FIT_NAMES: [keyof Omit<WorkflowFit, "mode">, string][] = [
  ["prompt", "prompt"],
  ["negative", "negative prompt"],
  ["checkpoint", "checkpoint"],
  ["size", "size"],
  ["count", "how many"],
  ["seed", "seed"],
];

/** What StoryTime can set in the workflow, or what is wrong with it. */
function workflowSummary(text: string, changed: Comfy["redraw"]): { ok: boolean; builtin: boolean; text: string } {
  try {
    const fit = describeWorkflow(parseWorkflow(text));
    if (fit.mode === "builtin") {
      const s = builtinSampler(changed);
      return { ok: true, builtin: true, text: `Using the built-in SDXL workflow (${s.steps} steps of ${s.sampler} ${s.scheduler}, CFG ${s.cfg}). It can also start from a picture.` };
    }
    const sets = FIT_NAMES.filter(([k]) => fit[k]).map(([, n]) => n);
    const misses = FIT_NAMES.filter(([k]) => !fit[k]).map(([, n]) => n);
    const how = fit.mode === "placeholders" ? "Placeholders found" : "Found automatically";
    if (!fit.prompt) return { ok: false, builtin: false, text: `${how}, but nothing for the prompt. Put {{prompt}} in the positive prompt's text.` };
    return {
      ok: true,
      builtin: false,
      text:
        `${how}: StoryTime sets the ${sets.join(", ")}.${misses.length ? ` The workflow keeps its own ${misses.join(", ")}.` : ""}` +
        (fit.image ? " It can start from a picture." : " It can't start from a picture."),
    };
  } catch (e) {
    return { ok: false, builtin: false, text: e instanceof WorkflowError ? e.message : String(e) };
  }
}

// Where the README explains how to install the edit models.
const SETUP_HELP = "https://github.com/tfProxy/StoryTime#edit-models-in-comfyui";

/** One line of the setup check: a tick or a cross, and what it means. */
function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? "ok" : "error"}>
      <span aria-hidden="true">{ok ? "✓ " : "✗ "}</span>
      {children}
    </li>
  );
}

/** What the setup check found: the picture workflow's nodes, the checkpoints, and each edit model's nodes and files. */
function CheckReport({ check }: { check: ComfyCheck }) {
  return (
    <div className="comfy-check" role="status">
      <p style={{ margin: 0 }}>Connected to ComfyUI {check.version}.</p>
      <h3>Making pictures</h3>
      <ul>
        <Line ok={check.checkpoints.length > 0}>
          {check.checkpoints.length > 0
            ? `${check.checkpoints.length} checkpoint${check.checkpoints.length === 1 ? "" : "s"} in models/checkpoints.`
            : "No checkpoints in models/checkpoints: put an SDXL checkpoint there and restart ComfyUI."}
        </Line>
        {check.workflowError ? (
          <Line ok={false}>{check.workflowError}</Line>
        ) : (
          <Line ok={check.missingNodes!.length === 0}>
            {check.missingNodes!.length === 0
              ? "ComfyUI has every node the picture workflow uses."
              : `ComfyUI doesn't have these nodes the picture workflow uses: ${check.missingNodes!.join(", ")}. Install the custom nodes they come from, or update ComfyUI.`}
          </Line>
        )}
      </ul>
      <h3>Edit models (for Edit this)</h3>
      {check.edits.map((e) => (
        <div key={e.model.id} className="comfy-check-model">
          <p style={{ margin: 0 }} className={e.ready ? "ok" : "error"}>
            <strong>{e.model.name}</strong>: {e.ready ? "ready." : "not ready, so it isn't offered."}
          </p>
          <ul>
            {e.parts.map((p) => (
              <Line key={p.part.key} ok={p.file !== null}>
                {p.part.label}:{" "}
                {p.file ? (
                  <code>{p.file}</code>
                ) : (
                  <>
                    missing. Put <code>{p.part.recommended}</code> in <code>ComfyUI/models/{p.part.folder}</code>.
                  </>
                )}
              </Line>
            ))}
            {e.missingNodes.length > 0 && (
              <Line ok={false}>ComfyUI doesn&apos;t have the nodes {e.missingNodes.join(", ")}. Update ComfyUI.</Line>
            )}
            {e.missingOptions.length > 0 && <Line ok={false}>ComfyUI is too old ({e.missingOptions.join("; ")}). Update ComfyUI.</Line>}
            {e.speedUp &&
              (e.speedUp.file ? (
                <Line ok>
                  {e.speedUp.part.label}: <code>{e.speedUp.file}</code> ({lightningSteps(e.speedUp.file)} steps)
                </Line>
              ) : (
                <li className="meta">
                  <span aria-hidden="true">– </span>
                  {e.speedUp.part.label}: not installed. For edits several times faster, put <code>{e.speedUp.part.recommended}</code> in{" "}
                  <code>ComfyUI/models/{e.speedUp.part.folder}</code>.
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="meta" style={{ margin: 0 }}>
        New files show up after ComfyUI is restarted (or after Refresh in its menu). <a href={SETUP_HELP} target="_blank" rel="noreferrer">Step-by-step setup</a>
      </p>
    </div>
  );
}

/** A strength slider: how far a picture may change from the one it starts from. */
function StrengthField({ label, value, onChange, children }: { label: string; value: number; onChange: (v: number) => void; children: React.ReactNode }) {
  const lim = TUNING_LIMITS.strength;
  return (
    <label className="strength">
      {label} {value.toFixed(2)}
      <input type="range" aria-label={label} min={lim.min} max={lim.max} step={lim.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <small>{children}</small>
    </label>
  );
}

const lists = (models: EditModels) => (models.state === "done" ? models : { loras: [], samplers: [], schedulers: [] });

/** New pictures and Redraw: the picture workflow, the redraw strength, and the built-in workflow's sampler. */
function RedrawCard({ comfy, models, onChange }: { comfy: Comfy; models: EditModels; onChange: (patch: Partial<Comfy>) => void }) {
  const summary = workflowSummary(comfy.workflow, comfy.redraw);
  const { samplers, schedulers } = lists(models);
  return (
    <section id="redraw" className="card picture-card">
      <h2>New pictures and Redraw</h2>
      <p className="meta" style={{ margin: 0 }}>
        Pictures made from a prompt, or redrawn from a picture with it. Each story chooses its checkpoint on its details page.
      </p>
      <StrengthField label="Redraw strength" value={comfy.denoise} onChange={(denoise) => onChange({ denoise })}>
        Low keeps the picture close; high changes more. The Redraw tab on the Illustrate page changes it too.
      </StrengthField>
      <details className="advanced">
        <summary>Advanced: steps, CFG, sampler</summary>
        {summary.builtin ? (
          <TuningFields
            value={builtinSampler(comfy.redraw)}
            defaults={BUILTIN_SAMPLER}
            changed={Object.keys(comfy.redraw).length > 0}
            samplers={samplers}
            schedulers={schedulers}
            onChange={(patch) => onChange({ redraw: { ...comfy.redraw, ...patch } })}
            onReset={() => onChange({ redraw: {} })}
          />
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            These are for the built-in workflow. Your own workflow keeps its own steps, CFG and sampler; change them in ComfyUI and export it again.
          </p>
        )}
      </details>
      <label>
        Workflow <small>(optional: paste a workflow exported from ComfyUI with Workflow › Export (API); leave empty for the built-in SDXL one)</small>
        <AutoTextarea
          style={{ minHeight: "4rem", maxHeight: "20rem", fontFamily: "monospace", fontSize: "0.8rem" }}
          value={comfy.workflow}
          spellCheck={false}
          onChange={(e) => onChange({ workflow: e.target.value })}
        />
      </label>
      <p className={summary.ok ? "meta" : "error"} style={{ margin: 0 }}>
        {summary.text}
      </p>
      <p className="meta" style={{ margin: 0 }}>
        In your own workflow, inputs set to <code>{"{{prompt}}"}</code>, <code>{"{{negative}}"}</code>,{" "}
        <code>{"{{checkpoint}}"}</code>, <code>{"{{width}}"}</code>, <code>{"{{height}}"}</code>, <code>{"{{count}}"}</code> and{" "}
        <code>{"{{seed}}"}</code> are filled in. Without them, StoryTime finds the checkpoint loader, empty latent image,
        sampler and prompt nodes itself. To start from a picture, put <code>{"{{image}}"}</code> in a Load Image node
        and <code>{"{{denoise}}"}</code> in the sampler&apos;s denoise; without placeholders, StoryTime swaps the empty
        latent image for the picture.
      </p>
    </section>
  );
}

/** One edit model: whether it is installed, Fast, its default strength, its LoRA stack and its sampler settings. */
function EditModelCard({ model, comfy, models, onChange }: { model: EditModel; comfy: Comfy; models: EditModels; onChange: (patch: Partial<Comfy>) => void }) {
  const changed = comfy.editTuning[model.id] ?? {};
  const tuning = editTuning(model, changed);
  // A patch, or null to reset the sampler settings (keeping the default strength, which has its own slider).
  const setTuning = (patch: Partial<typeof changed> | null) =>
    onChange({
      editTuning: {
        ...comfy.editTuning,
        [model.id]: patch ? { ...changed, ...patch } : changed.strength !== undefined ? { strength: changed.strength } : {},
      },
    });
  const { loras, samplers, schedulers } = lists(models);
  const check = models.state === "done" ? models.ready.find((c) => c.model.id === model.id) : undefined;
  const speedUp = check?.files.speedUp ?? null;
  const { strength, ...sampler } = tuning;
  const samplerChanged = Object.keys(changed).some((k) => k !== "strength");
  return (
    <section id={`edit-${model.id}`} className="card picture-card" aria-label={`Edit: ${model.name}`}>
      <h2>Edit: {model.name}</h2>
      <p className="meta" style={{ margin: 0 }}>{model.blurb}</p>
      {models.state === "done" && (
        <p className={check ? "ok" : "error"} style={{ margin: 0 }}>
          {check ? "Installed in ComfyUI." : "Not installed in ComfyUI, so Edit this doesn't offer it. Check setup above says what is missing."}
        </p>
      )}
      {model.speedUp && (
        <label className="inline-label" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={comfy.editFast} disabled={!speedUp} onChange={(e) => onChange({ editFast: e.target.checked })} />
          <span>
            Fast with the {model.speedUp.name} LoRA{" "}
            <small>
              {speedUp
                ? `(${lightningSteps(speedUp)} steps at CFG 1 instead of the steps and CFG below; a little less detail)`
                : `(not installed: put ${model.speedUp.recommended} in ComfyUI/models/${model.speedUp.folder})`}
            </small>
          </span>
        </label>
      )}
      <StrengthField label={`Default strength for ${model.name}`} value={strength} onChange={(v) => setTuning({ strength: v })}>
        Where the Edit tab&apos;s strength starts. 1 lets the model follow the instruction freely; lower starts from the
        picture with less noise, so more of it stays as it was (too low and the change may not happen).
      </StrengthField>
      <EditLoraStack
        model={model}
        stack={comfy.editLoras[model.id] ?? []}
        available={loras}
        onChange={(stack) => onChange({ editLoras: { ...comfy.editLoras, [model.id]: stack } })}
      />
      <details className="advanced">
        <summary>Advanced: steps, CFG, sampler{model.defaults.shift !== undefined ? ", shift" : ""}{model.defaults.guidance !== undefined ? ", guidance" : ""}</summary>
        <TuningFields
          value={sampler}
          defaults={model.defaults}
          changed={samplerChanged}
          samplers={samplers}
          schedulers={schedulers}
          onChange={(patch) => setTuning(patch)}
          onReset={() => setTuning(null)}
        >
          {model.speedUp && speedUp && comfy.editFast && (
            <p className="meta" style={{ margin: 0 }}>
              Fast is on, so edits use {lightningSteps(speedUp)} steps at CFG 1; the sampler, scheduler and shift still apply.
            </p>
          )}
        </TuningFields>
      </details>
    </section>
  );
}

/**
 * Settings › Pictures: the setup check, then a card for new pictures and Redraw, and one for each edit
 * model. `onConnections` goes to the Connections tab, where the ComfyUI address is.
 */
export default function PictureSettings({ comfy, onChange, onConnections }: { comfy: Comfy; onChange: (patch: Partial<Comfy>) => void; onConnections: () => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ComfyCheck | null>(null);
  // Each check asks ComfyUI again, so the cards below see new files; they ask afresh when it changes.
  const [checks, setChecks] = useState(0);

  async function runCheck() {
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      setCheck(await checkComfy(comfy.url, comfy.workflow));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      setChecks((n) => n + 1);
    }
  }

  return (
    <div className="settings-section">
      <section id="picture-setup" className="settings-section">
        <h2>ComfyUI setup</h2>
        {!comfy.url ? (
          <p className="meta" style={{ margin: 0 }}>
            Add the ComfyUI address on the{" "}
            <button type="button" className="link-button" onClick={onConnections}>
              Connections tab
            </button>{" "}
            first.
          </p>
        ) : (
          <>
            <p className="meta" style={{ margin: 0 }}>
              Checks what ComfyUI at <code>{comfy.url}</code> has: the checkpoints, and the files and nodes each edit model needs.
            </p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => void runCheck()} disabled={checking}>
                {checking ? "Checking…" : "Check setup"}
              </button>
              {error && <span className="error">{error}</span>}
            </div>
            {check && <CheckReport check={check} />}
          </>
        )}
      </section>
      <PictureCards key={checks} comfy={comfy} onChange={onChange} />
    </div>
  );
}

/** The cards, with what ComfyUI has (asked when Settings opens, and again after each check). */
function PictureCards({ comfy, onChange }: { comfy: Comfy; onChange: (patch: Partial<Comfy>) => void }) {
  const models = useEditModels(comfy.url, true);
  return (
    <>
      {comfy.url && models.state === "checking" && <p className="meta" style={{ margin: 0 }}>Asking ComfyUI what it has…</p>}
      {comfy.url && models.state === "error" && (
        <p className="error" style={{ margin: 0 }} title={models.message}>
          Couldn&apos;t ask ComfyUI what it has, so its LoRAs and samplers aren&apos;t listed. Check setup says why.
        </p>
      )}
      {models.state === "done" && models.loras.length === 0 && (
        <p className="notice" style={{ margin: 0 }}>
          ComfyUI lists no LoRAs. Put LoRA files in <code>ComfyUI/models/loras</code> and restart ComfyUI.
        </p>
      )}
      <RedrawCard comfy={comfy} models={models} onChange={onChange} />
      {EDIT_MODELS.map((m) => (
        <EditModelCard key={m.id} model={m} comfy={comfy} models={models} onChange={onChange} />
      ))}
    </>
  );
}
