"use client";

import { useState, useSyncExternalStore } from "react";
import type { ComfySettings as Comfy } from "@/lib/settingsSchema";
import { comfyVersion, listCheckpoints } from "@/lib/comfy/client";
import { describeWorkflow, parseWorkflow, WorkflowError, type WorkflowFit } from "@/lib/comfy/workflow";
import AutoTextarea from "./AutoTextarea";

const noop = () => () => {};
/** This page's origin, which ComfyUI has to allow; "" while rendering on the server. */
const useOrigin = () => useSyncExternalStore(noop, () => location.origin, () => "");

const FIT_NAMES: [keyof Omit<WorkflowFit, "mode">, string][] = [
  ["prompt", "prompt"],
  ["negative", "negative prompt"],
  ["checkpoint", "checkpoint"],
  ["size", "size"],
  ["count", "how many"],
  ["seed", "seed"],
];

/** What StoryTime can set in the workflow, or what is wrong with it. */
function workflowSummary(text: string): { ok: boolean; text: string } {
  try {
    const fit = describeWorkflow(parseWorkflow(text));
    if (fit.mode === "builtin") return { ok: true, text: "Using the built-in SDXL workflow (30 steps, DPM++ 2M Karras, CFG 6). It can also start from a picture." };
    const sets = FIT_NAMES.filter(([k]) => fit[k]).map(([, n]) => n);
    const misses = FIT_NAMES.filter(([k]) => !fit[k]).map(([, n]) => n);
    const how = fit.mode === "placeholders" ? "Placeholders found" : "Found automatically";
    if (!fit.prompt) return { ok: false, text: `${how}, but nothing for the prompt. Put {{prompt}} in the positive prompt's text.` };
    return {
      ok: true,
      text:
        `${how}: StoryTime sets the ${sets.join(", ")}.${misses.length ? ` The workflow keeps its own ${misses.join(", ")}.` : ""}` +
        (fit.image ? " It can start from a picture." : " It can't start from a picture."),
    };
  } catch (e) {
    return { ok: false, text: e instanceof WorkflowError ? e.message : String(e) };
  }
}

/** The ComfyUI section of Settings: where it is, a connection test, and an optional workflow of your own. */
export default function ComfySettings({ comfy, onChange }: { comfy: Comfy; onChange: (patch: Partial<Comfy>) => void }) {
  const origin = useOrigin();
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const summary = workflowSummary(comfy.workflow);

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const version = await comfyVersion(comfy.url);
      const checkpoints = await listCheckpoints(comfy.url);
      setStatus({ ok: true, text: `Connected to ComfyUI ${version}. ${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} available.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section id="pictures" className="settings-section">
      <h2>Pictures (ComfyUI)</h2>
      <p className="meta" style={{ margin: 0 }}>
        Make chapter pictures on a ComfyUI machine from the Illustrate chapter page. Your browser talks to ComfyUI
        directly, so start ComfyUI with <code>--enable-cors-header {origin || "<this site's address>"}</code>
        {origin.startsWith("https:") && ", and serve it over https, since this page is on https"}.
      </p>
      <label>
        ComfyUI address
        <input
          type="url"
          value={comfy.url}
          placeholder="https://comfy.example.ts.net"
          onChange={(e) => onChange({ url: e.target.value.trim() })}
        />
      </label>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void test()} disabled={testing || !comfy.url}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
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
