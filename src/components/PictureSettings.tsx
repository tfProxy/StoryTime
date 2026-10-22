"use client";

import { useEffect, useState } from "react";
import { TUNING_LIMITS, type ComfySettings as Comfy } from "@/lib/settingsSchema";
import { BUILTIN_SAMPLER, builtinSampler, describeWorkflow, parseWorkflow, WorkflowError, type WorkflowFit } from "@/lib/comfy/workflow";
import { checkComfy, type ComfyCheck } from "@/lib/comfy/check";
import { listCheckpoints } from "@/lib/comfy/client";
import { editModel, editPresetCheck, editTuning, isGguf, lightningSteps, presetCheck, type EditModel } from "@/lib/comfy/editModels";
import {
  drawPresetSummary,
  fileLabel,
  freeName,
  MAX_PRESETS,
  newDrawPreset,
  newEditPreset,
  presetId,
  presetName,
  PROMPT_STYLE_NAMES,
  type DrawPreset,
  type EditPreset,
  type PromptStyle,
} from "@/lib/comfy/presets";
import AutoTextarea from "./AutoTextarea";
import LoraStack from "./LoraStack";
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
function workflowSummary(text: string, changed: DrawPreset["sampler"]): { ok: boolean; builtin: boolean; text: string } {
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
const SETUP_HELP = "https://github.com/tfProxy/StoryTime/blob/main/docs/pictures.md#edit-models-in-comfyui";

/** One line of the setup check: a tick or a cross, and what it means. */
function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? "ok" : "error"}>
      <span aria-hidden="true">{ok ? "✓ " : "✗ "}</span>
      {children}
    </li>
  );
}

/** What ComfyUI has, asked when Settings opens and again after each setup check, shared by the picture tabs. */
export type PictureSetup = {
  check: ComfyCheck | null;
  checking: boolean;
  error: string | null;
  run: () => void;
  models: EditModels;
  /** ComfyUI's checkpoints, for the drawing presets; null until known. */
  checkpoints: string[] | null;
};

export function usePictureSetup(comfy: Comfy): PictureSetup {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ComfyCheck | null>(null);
  // Each check asks ComfyUI again, so the cards see new files.
  const [checks, setChecks] = useState(0);
  const models = useEditModels(comfy.url, checks);
  const [listed, setListed] = useState<{ url: string; list: string[] } | null>(null);
  useEffect(() => {
    if (!comfy.url) return;
    let live = true;
    listCheckpoints(comfy.url).then(
      (list) => live && setListed({ url: comfy.url, list }),
      () => {}, // the edit models' question says ComfyUI can't be reached
    );
    return () => {
      live = false;
    };
  }, [comfy.url, checks]);

  async function run() {
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      setCheck(await checkComfy(comfy.url, comfy.drawPresets));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      setChecks((n) => n + 1);
    }
  }
  return { check, checking, error, run: () => void run(), models, checkpoints: listed?.url === comfy.url ? listed.list : null };
}

/** The setup check's findings for drawing: the checkpoints, and each drawing preset's checkpoint, nodes and LoRAs. */
function DrawReport({ check }: { check: ComfyCheck }) {
  return (
    <div className="comfy-check" role="status">
      <p style={{ margin: 0 }}>Connected to ComfyUI {check.version}.</p>
      <ul>
        <Line ok={check.checkpoints.length > 0}>
          {check.checkpoints.length > 0
            ? `${check.checkpoints.length} checkpoint${check.checkpoints.length === 1 ? "" : "s"} in models/checkpoints.`
            : "No checkpoints in models/checkpoints: put an SDXL checkpoint there and restart ComfyUI."}
        </Line>
      </ul>
      {check.draws.map((d) => (
        <div key={d.preset.id} className="comfy-check-model">
          <p style={{ margin: 0 }}>
            <strong>{presetName(d.preset)}</strong>
          </p>
          <ul>
            <Line ok={d.checkpoint}>
              {d.checkpoint ? (
                <>
                  Checkpoint: <code>{d.preset.checkpoint}</code>
                </>
              ) : d.preset.checkpoint ? (
                <>
                  ComfyUI doesn&apos;t list its checkpoint <code>{d.preset.checkpoint}</code>.
                </>
              ) : (
                "No checkpoint chosen."
              )}
            </Line>
            {d.workflowError ? (
              <Line ok={false}>{d.workflowError}</Line>
            ) : (
              <Line ok={d.missingNodes!.length === 0}>
                {d.missingNodes!.length === 0
                  ? "ComfyUI has every node its workflow uses."
                  : `ComfyUI doesn't have these nodes its workflow uses: ${d.missingNodes!.join(", ")}. Install the custom nodes they come from, or update ComfyUI.`}
              </Line>
            )}
            {d.missingLoras.length > 0 && <Line ok={false}>ComfyUI doesn&apos;t list its LoRAs {d.missingLoras.join(", ")}.</Line>}
          </ul>
        </div>
      ))}
      <p className="meta" style={{ margin: 0 }}>New files show up after ComfyUI is restarted (or after Refresh in its menu).</p>
    </div>
  );
}

/** The setup check's findings for one edit model: its files and nodes, and the optional speed-up. */
function EditReport({ check, model }: { check: ComfyCheck; model: EditModel }) {
  const e = check.edits.find((c) => c.model.id === model.id);
  if (!e) return null;
  return (
    <div className="comfy-check" role="status">
      <p style={{ margin: 0 }}>Connected to ComfyUI {check.version}.</p>
      <p style={{ margin: 0 }} className={e.ready ? "ok" : "error"}>
        <strong>{e.model.name}</strong>: {e.ready ? "ready." : "not ready, so Edit this doesn't offer it."}
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
        {e.missingNodes.length > 0 && <Line ok={false}>ComfyUI doesn&apos;t have the nodes {e.missingNodes.join(", ")}. Update ComfyUI.</Line>}
        {e.ggufMissing.length > 0 && <li className="meta">GGUF files: install the ComfyUI-GGUF custom nodes to use them.</li>}
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
      <p className="meta" style={{ margin: 0 }}>
        New files show up after ComfyUI is restarted (or after Refresh in its menu). <a href={SETUP_HELP} target="_blank" rel="noreferrer">Step-by-step setup</a>
      </p>
    </div>
  );
}

/** The Check setup button and what it found for this tab (`model` for an edit model's tab, else drawing). */
function SetupSection({ id, comfy, setup, model, onConnections }: { id: string; comfy: Comfy; setup: PictureSetup; model?: EditModel; onConnections: () => void }) {
  const { models } = setup;
  return (
    <section id={id} className="settings-section">
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
            Checks what ComfyUI at <code>{comfy.url}</code> has: {model ? `the files and nodes ${model.name} needs` : "the checkpoints, and what each preset uses"}.
          </p>
          <div className="row">
            <button type="button" className="secondary" onClick={setup.run} disabled={setup.checking}>
              {setup.checking ? "Checking…" : "Check setup"}
            </button>
            {setup.error && <span className="error">{setup.error}</span>}
          </div>
          {setup.check && (model ? <EditReport check={setup.check} model={model} /> : <DrawReport check={setup.check} />)}
          {models.state === "checking" && <p className="meta" style={{ margin: 0 }}>Asking ComfyUI what it has…</p>}
          {models.state === "error" && (
            <p className="error" style={{ margin: 0 }} title={models.message}>
              Couldn&apos;t ask ComfyUI what it has, so its LoRAs and samplers aren&apos;t listed. Check setup says why.
            </p>
          )}
          {models.state === "done" && models.loras.length === 0 && (
            <p className="notice" style={{ margin: 0 }}>
              ComfyUI lists no LoRAs. Put LoRA files in <code>ComfyUI/models/loras</code> and restart ComfyUI.
            </p>
          )}
        </>
      )}
    </section>
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

/**
 * A preset's card: its name and a summary line, opened to change it. It starts open when it is the only one,
 * was just added, or is linked to (#preset-<id>, which SettingsForm opens).
 */
function PresetCard({
  preset,
  summary,
  startOpen,
  kind,
  children,
  actions,
}: {
  preset: { id: string; name: string };
  summary: React.ReactNode;
  startOpen: boolean;
  kind: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  // Only how it starts: after that the author opens and closes it.
  const [open] = useState(startOpen);
  return (
    <details id={`preset-${preset.id}`} className="card picture-card preset-card" open={open} aria-label={`${kind}: ${presetName(preset)}`}>
      <summary>
        <strong>{presetName(preset)}</strong> <span className="meta">{summary}</span>
      </summary>
      <div className="preset-body">
        {children}
        <div className="row preset-actions">{actions}</div>
      </div>
    </details>
  );
}

/** The name box at the top of a preset's card. */
function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <label>
      Name
      <input aria-label="Preset name" value={value} maxLength={100} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** The add / duplicate / delete logic both kinds of preset list share. */
function usePresetList<P extends { id: string; name: string }>(presets: P[], save: (next: P[]) => void, kind: string) {
  // The preset just added, so its card starts open.
  const [added, setAdded] = useState<string | null>(null);
  const names = presets.map((p) => p.name);
  const full = presets.length >= MAX_PRESETS;
  return {
    added,
    full,
    add(p: P, after?: string) {
      const i = after ? presets.findIndex((x) => x.id === after) + 1 : presets.length;
      save([...presets.slice(0, i), p, ...presets.slice(i)]);
      setAdded(p.id);
    },
    copyName: (p: P) => freeName(`${presetName(p)} copy`, names),
    newName: () => freeName("New preset", names),
    change: (id: string, patch: Partial<P>) => save(presets.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    remove(p: P, consequence: string) {
      if (!window.confirm(`Delete the ${kind} “${presetName(p)}”?${consequence}`)) return;
      save(presets.filter((x) => x.id !== p.id));
    },
  };
}

/** One drawing preset's settings: name, checkpoint, Redraw strength, LoRAs, sampler and workflow. */
function DrawPresetFields({ preset, setup, onChange }: { preset: DrawPreset; setup: PictureSetup; onChange: (patch: Partial<DrawPreset>) => void }) {
  const summary = workflowSummary(preset.workflow, preset.sampler);
  const { loras, samplers, schedulers } = lists(setup.models);
  const checkpoints = setup.checkpoints ?? [];
  const known = checkpoints.includes(preset.checkpoint);
  // The workflow box starts open when there is one in it.
  const [workflowOpen] = useState(preset.workflow.trim() !== "");
  return (
    <>
      <NameField value={preset.name} onChange={(name) => onChange({ name })} />
      <label>
        Checkpoint
        <select aria-label="Checkpoint" value={preset.checkpoint} onChange={(e) => onChange({ checkpoint: e.target.value })}>
          {!preset.checkpoint && <option value="">{setup.checkpoints ? "Choose one…" : "Not chosen"}</option>}
          {preset.checkpoint && !known && (
            <option value={preset.checkpoint}>
              {preset.checkpoint}
              {setup.checkpoints ? " (not in ComfyUI)" : ""}
            </option>
          )}
          {checkpoints.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt style
        <select aria-label="Prompt style" value={preset.promptStyle} onChange={(e) => onChange({ promptStyle: e.target.value as PromptStyle })}>
          {(Object.keys(PROMPT_STYLE_NAMES) as PromptStyle[]).map((s) => (
            <option key={s} value={s}>
              {PROMPT_STYLE_NAMES[s]}
            </option>
          ))}
        </select>
        <span className="meta">How the AI writes picture prompts for this model.</span>
      </label>
      <label>
        Preset prompt
        <textarea
          aria-label="Preset prompt"
          rows={2}
          maxLength={4000}
          value={preset.prompt}
          placeholder="e.g. masterpiece, best quality"
          onChange={(e) => onChange({ prompt: e.target.value })}
        />
        <span className="meta">Added to every prompt drawn with this preset, without repeating tags the prompt already has.</span>
      </label>
      <label>
        Preset negative prompt
        <textarea
          aria-label="Preset negative prompt"
          rows={2}
          maxLength={4000}
          value={preset.negative}
          placeholder="e.g. lowres, watermark"
          onChange={(e) => onChange({ negative: e.target.value })}
        />
        <span className="meta">Added to every negative prompt drawn with this preset.</span>
      </label>
      <StrengthField label="Redraw strength" value={preset.denoise} onChange={(denoise) => onChange({ denoise })}>
        Where the Redraw tab&apos;s strength starts. Low keeps the picture close; high changes more.
      </StrengthField>
      <LoraStack
        label={presetName(preset)}
        madeFor={preset.checkpoint ? `${fileLabel(preset.checkpoint)}'s kind of model (SDXL, Pony, SD 1.5…)` : "the checkpoint's kind of model"}
        stack={preset.loras}
        available={loras}
        onChange={(stack) => onChange({ loras: stack })}
      />
      <details className="advanced">
        <summary>Advanced: steps, CFG, sampler</summary>
        {summary.builtin ? (
          <TuningFields
            value={builtinSampler(preset.sampler)}
            defaults={BUILTIN_SAMPLER}
            changed={Object.keys(preset.sampler).length > 0}
            samplers={samplers}
            schedulers={schedulers}
            onChange={(patch) => onChange({ sampler: { ...preset.sampler, ...patch } })}
            onReset={() => onChange({ sampler: {} })}
          />
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            These are for the built-in workflow. Your own workflow keeps its own steps, CFG and sampler; change them in ComfyUI and export it again.
          </p>
        )}
      </details>
      <details className="advanced" open={workflowOpen}>
        <summary>Workflow: {summary.builtin ? "built-in SDXL" : "your own"}</summary>
        <label>
          Workflow <small>(optional: paste a workflow exported from ComfyUI with Workflow › Export (API); leave empty for the built-in SDXL one)</small>
          <AutoTextarea
            aria-label="Workflow"
            style={{ minHeight: "4rem", maxHeight: "20rem", fontFamily: "monospace", fontSize: "0.8rem" }}
            value={preset.workflow}
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
          latent image for the picture. The LoRAs go after its Load Checkpoint (or Load Diffusion Model) node.
        </p>
      </details>
    </>
  );
}

/** Settings › Drawing: the setup check, then a card for each drawing preset. */
export function DrawingSettings({
  comfy,
  setup,
  onChange,
  onConnections,
}: {
  comfy: Comfy;
  setup: PictureSetup;
  onChange: (patch: Partial<Comfy>) => void;
  onConnections: () => void;
}) {
  const presets = comfy.drawPresets;
  const list = usePresetList(presets, (drawPresets) => onChange({ drawPresets }), "drawing preset");
  return (
    <div className="settings-section">
      <SetupSection id="setup-drawing" comfy={comfy} setup={setup} onConnections={onConnections} />
      <section id="drawing-presets" className="settings-section">
        <h2>Drawing presets</h2>
        <p className="meta" style={{ margin: 0 }}>
          How new pictures are drawn, and redrawn from a picture: the checkpoint, its LoRAs and the sampler. Each story chooses its
          preset on its details page (stories that choose none use the top one), and a chapter can choose another on the Illustrate page.
        </p>
        {presets.map((p, i) => (
          <PresetCard
            key={p.id}
            preset={p}
            kind="Drawing preset"
            summary={
              <>
                {drawPresetSummary(p)}
                {i === 0 && " · top: for stories that choose none"}
              </>
            }
            startOpen={presets.length === 1 || list.added === p.id}
            actions={
              <>
                <button type="button" className="secondary" disabled={list.full} onClick={() => list.add({ ...p, id: presetId("draw"), name: list.copyName(p) }, p.id)}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={i === 0}
                  title="Stories that choose no preset use the top one"
                  onClick={() => onChange({ drawPresets: [p, ...presets.filter((x) => x.id !== p.id)] })}
                >
                  Move to top
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={presets.length === 1}
                  title={presets.length === 1 ? "There has to be one drawing preset" : undefined}
                  onClick={() => list.remove(p, " Stories and chapters that use it switch to the top preset.")}
                >
                  Delete
                </button>
              </>
            }
          >
            <DrawPresetFields preset={p} setup={setup} onChange={(patch) => list.change(p.id, patch)} />
          </PresetCard>
        ))}
        <div>
          <button type="button" disabled={list.full} onClick={() => list.add(newDrawPreset(presetId("draw"), list.newName()))}>
            New drawing preset
          </button>
        </div>
      </section>
    </div>
  );
}

/** An edit preset in a few words: its own model file if it chose one, Fast, its LoRAs, and its strength. */
function editPresetSummary(p: EditPreset, model: EditModel): string {
  const on = p.loras.filter((l) => l.on && l.name).length;
  const strength = editTuning(model, p.tuning).strength;
  const own = p.checkpoint || p.files.model;
  return [own && fileLabel(own), model.speedUp && p.fast && "fast", on > 0 && `${on} LoRA${on === 1 ? "" : "s"}`, `strength ${strength.toFixed(2)}`]
    .filter(Boolean)
    .join(" · ");
}

/** The value of the Model select: "" for the file found by its name, else which folder and file. */
const modelValue = (p: EditPreset) => (p.checkpoint ? `checkpoint:${p.checkpoint}` : p.files.model ? `model:${p.files.model}` : "");

/** Options for files, with the chosen one added (marked) when ComfyUI doesn't list it. */
function FileOptions({ files, chosen, prefix = "" }: { files: string[]; chosen?: string; prefix?: string }) {
  return (
    <>
      {chosen && !files.includes(chosen) && <option value={prefix + chosen}>{chosen} (not in ComfyUI)</option>}
      {files.map((f) => (
        <option key={f} value={prefix + f}>
          {f}
          {isGguf(f) ? " (GGUF)" : ""}
        </option>
      ))}
    </>
  );
}

/**
 * An edit preset's model files: the model (one in `diffusion_models`, or an all-in-one checkpoint that has
 * the text encoder and VAE in it too), and the text encoders and VAE. Each can be left to the file found
 * by its name, so uncensored or other fine-tuned models can be used by some presets and not others.
 */
function ModelFiles({ preset, model, setup, onChange }: { preset: EditPreset; model: EditModel; setup: PictureSetup; onChange: (patch: Partial<EditPreset>) => void }) {
  const base = setup.models.state === "done" ? setup.models.checks.find((c) => c.model.id === model.id) : undefined;
  const check = base ? presetCheck(base, preset) : undefined;
  const [modelPart, ...others] = model.parts;
  const listed = (key: string) => base?.parts.find((p) => p.part.key === key);
  const found = (key: string) => listed(key)?.file;
  const setFile = (key: string, file: string) => {
    const files = { ...preset.files };
    if (file) files[key] = file;
    else delete files[key];
    onChange({ files });
  };
  function setModel(value: string) {
    const [kind, ...rest] = value.split(":");
    const file = rest.join(":");
    const files = { ...preset.files };
    delete files[modelPart.key];
    if (kind === "model") files[modelPart.key] = file;
    onChange({ checkpoint: kind === "checkpoint" ? file : "", files });
  }
  const chosenAny = preset.checkpoint !== "" || Object.keys(preset.files).length > 0;
  // Open to start with when the preset chose files of its own.
  const [open] = useState(chosenAny);
  const problems = check
    ? [
        ...(check.checkpoint && !check.checkpoint.found ? [`ComfyUI doesn't list the checkpoint ${check.checkpoint.file}.`] : []),
        ...check.parts
          .filter((p) => p.file === null && !p.fromCheckpoint)
          .map((p) => (p.chosen ? `ComfyUI doesn't list ${p.chosen} (${p.part.label}).` : `No ${p.part.label} found in ComfyUI/models/${p.part.folder}.`)),
      ]
    : [];
  return (
    <details className="advanced" open={open || undefined}>
      <summary>Model files: {preset.checkpoint ? `checkpoint ${fileLabel(preset.checkpoint)}` : chosenAny ? "chosen here" : "found by their names"}</summary>
      <div className="preset-body">
        <p className="meta" style={{ margin: 0 }}>
          To use a fine-tuned or uncensored {model.name}, choose its file here. An all-in-one checkpoint (in{" "}
          <code>ComfyUI/models/checkpoints</code>) has the text encoder and VAE in it too.
        </p>
        <label>
          Model
          <select aria-label={`Model for ${presetName(preset)}`} value={modelValue(preset)} onChange={(e) => setModel(e.target.value)}>
            <option value="">Found by its name{found(modelPart.key) ? ` (${found(modelPart.key)})` : " (none found)"}</option>
            <optgroup label={`Models (models/${modelPart.folder})`}>
              <FileOptions files={listed(modelPart.key)?.choices ?? []} chosen={preset.checkpoint ? undefined : preset.files[modelPart.key]} prefix="model:" />
            </optgroup>
            <optgroup label="All-in-one checkpoints (models/checkpoints)">
              <FileOptions files={base?.checkpoints ?? []} chosen={preset.checkpoint || undefined} prefix="checkpoint:" />
            </optgroup>
          </select>
        </label>
        {others.map((part) => (
          <label key={part.key}>
            {part.label}
            <select value={preset.files[part.key] ?? ""} onChange={(e) => setFile(part.key, e.target.value)}>
              <option value="">
                {preset.checkpoint ? "The checkpoint's own" : `Found by its name${found(part.key) ? ` (${found(part.key)})` : " (none found)"}`}
              </option>
              <FileOptions files={listed(part.key)?.choices ?? []} chosen={preset.files[part.key]} />
            </select>
          </label>
        ))}
        {preset.checkpoint && (
          <p className="meta" style={{ margin: 0 }}>
            Some all-in-one checkpoints have a speed-up merged in (Phr00t&apos;s Rapid AIO has Lightning). Then untick Fast,
            and set the steps, CFG and sampler under Advanced as the checkpoint&apos;s page says.
          </p>
        )}
        {check &&
          (problems.length === 0 ? (
            <p className="ok" style={{ margin: 0 }}>
              ComfyUI has every file this preset uses.
            </p>
          ) : (
            <p className="error" style={{ margin: 0 }}>
              {problems.join(" ")} Edit this doesn&apos;t offer this preset until it does.
            </p>
          ))}
        {setup.models.state !== "done" && <p className="meta" style={{ margin: 0 }}>The files are listed once ComfyUI answers.</p>}
      </div>
    </details>
  );
}

/** One edit preset's settings: name, Fast, default strength, LoRAs and the model's sampler settings. */
function EditPresetFields({ preset, model, setup, onChange }: { preset: EditPreset; model: EditModel; setup: PictureSetup; onChange: (patch: Partial<EditPreset>) => void }) {
  const changed = preset.tuning;
  const tuning = editTuning(model, changed);
  // A patch, or null to reset the sampler settings (keeping the default strength, which has its own slider).
  const setTuning = (patch: Partial<typeof changed> | null) =>
    onChange({ tuning: patch ? { ...changed, ...patch } : changed.strength !== undefined ? { strength: changed.strength } : {} });
  const { loras, samplers, schedulers } = lists(setup.models);
  const check = setup.models.state === "done" ? editPresetCheck(setup.models.checks, preset) : null;
  const speedUp = check?.speedUp?.file ?? null;
  const { strength, ...sampler } = tuning;
  const samplerChanged = Object.keys(changed).some((k) => k !== "strength");
  return (
    <>
      <NameField value={preset.name} onChange={(name) => onChange({ name })} />
      <ModelFiles preset={preset} model={model} setup={setup} onChange={onChange} />
      <label className="inline-label" style={{ alignItems: "flex-start" }}>
        <input
          type="checkbox"
          aria-label={`Text encoder on the CPU for ${presetName(preset)}`}
          checked={preset.textEncoderDevice === "cpu"}
          disabled={!!check && !check.devices.includes("cpu")}
          onChange={(e) => onChange({ textEncoderDevice: e.target.checked ? "cpu" : "default" })}
        />
        <span>
          Keep the text encoder on the CPU{" "}
          <small>
            (in system memory, so the graphics card has room for the model; reading the instruction is a little slower
            {check && !check.devices.includes("cpu") ? ". Doesn't apply: the text encoder loader in use has no such choice" : ""})
          </small>
        </span>
      </label>
      {model.speedUp && (
        <label className="inline-label" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={preset.fast} disabled={!speedUp} onChange={(e) => onChange({ fast: e.target.checked })} />
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
      <StrengthField label="Default strength" value={strength} onChange={(v) => setTuning({ strength: v })}>
        Where the Edit tab&apos;s strength starts. 1 lets the model follow the instruction freely; lower starts from the
        picture with less noise, so more of it stays as it was (too low and the change may not happen).
      </StrengthField>
      <LoraStack label={presetName(preset)} madeFor={model.name} stack={preset.loras} available={loras} onChange={(stack) => onChange({ loras: stack })}>
        {model.speedUp && <p className="meta" style={{ margin: 0 }}>They go after the {model.speedUp.name} LoRA when Fast is on.</p>}
      </LoraStack>
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
          {model.speedUp && speedUp && preset.fast && (
            <p className="meta" style={{ margin: 0 }}>
              Fast is on, so edits use {lightningSteps(speedUp)} steps at CFG 1; the sampler, scheduler and shift still apply.
            </p>
          )}
        </TuningFields>
      </details>
    </>
  );
}

/** Settings › an edit model's tab (Qwen edit, Flux edit): the setup check, then a card for each of its presets. */
export function EditSettings({
  modelId,
  comfy,
  setup,
  onChange,
  onConnections,
}: {
  modelId: EditPreset["model"];
  comfy: Comfy;
  setup: PictureSetup;
  onChange: (patch: Partial<Comfy>) => void;
  onConnections: () => void;
}) {
  const model = editModel(modelId)!;
  const mine = comfy.editPresets.filter((p) => p.model === modelId);
  // Changes to this model's presets, kept in their places among the others.
  const save = (next: EditPreset[]) => {
    const others = comfy.editPresets.filter((p) => p.model !== modelId);
    onChange({ editPresets: [...others, ...next] });
  };
  const list = usePresetList(mine, save, `${model.name} preset`);
  const installed = setup.models.state === "done" ? setup.models.ready.some((c) => c.model.id === modelId) : null;
  return (
    <div className="settings-section">
      <SetupSection id={`setup-${modelId}`} comfy={comfy} setup={setup} model={model} onConnections={onConnections} />
      <section id={`${modelId}-presets`} className="settings-section">
        <h2>{model.name} presets</h2>
        <p className="meta" style={{ margin: 0 }}>
          {model.blurb} Each preset has its own LoRAs and settings; choose one on the Illustrate page&apos;s Edit tab.
        </p>
        {installed !== null && (
          <p className={installed ? "ok" : "error"} style={{ margin: 0 }}>
            {installed
              ? `${model.name} is installed in ComfyUI.`
              : `ComfyUI doesn't have ${model.name}'s usual files. Check setup says what is missing; or choose a preset's own under Model files.`}
          </p>
        )}
        {mine.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            kind={`${model.name} preset`}
            summary={editPresetSummary(p, model)}
            startOpen={mine.length === 1 || list.added === p.id}
            actions={
              <>
                <button type="button" className="secondary" disabled={list.full} onClick={() => list.add({ ...p, id: presetId("edit"), name: list.copyName(p) }, p.id)}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={mine.length === 1}
                  title={mine.length === 1 ? `There has to be one ${model.name} preset` : undefined}
                  onClick={() => list.remove(p, "")}
                >
                  Delete
                </button>
              </>
            }
          >
            <EditPresetFields preset={p} model={model} setup={setup} onChange={(patch) => list.change(p.id, patch)} />
          </PresetCard>
        ))}
        <div>
          <button type="button" disabled={list.full} onClick={() => list.add(newEditPreset(presetId("edit"), list.newName(), modelId))}>
            New {model.name} preset
          </button>
        </div>
      </section>
    </div>
  );
}
