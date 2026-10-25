"use client";

// Make missing pictures (/s/<id>/pictures): the form that starts a run for the header and/or footer pictures chapters
// lack, an unfinished run offered first, and the run in progress.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { claim, finish } from "@/lib/aiRuns/runner";
import { estimatePictures, planPictures, type PictureChapter } from "@/lib/aiRuns/plan";
import type { RunOptions } from "@/lib/aiRuns/types";
import { LIMITS } from "@/lib/limits";
import { usableRef, useSettings, type ModelRef } from "@/lib/settings";
import AiRunProgress from "./AiRunProgress";
import ModelPicker from "./ModelPicker";
import { useWorkQueue } from "./WorkQueue";

/** The chapters each scope covers, in outline order (the page works them out on the server). */
export type ScopeChapters = {
  whole: PictureChapter[];
  /** A chapter and everything below it. */
  from?: { id: string; title: string; chapters: PictureChapter[] };
  /** The chapters a write-ahead run wrote. */
  run?: { id: string; chapters: PictureChapter[] };
};

type Scope = "whole" | "from" | "run";

export default function MissingPictures({
  storyId,
  scopes,
  runId,
  unfinished,
}: {
  storyId: string;
  scopes: ScopeChapters;
  runId: string | null;
  unfinished: { id: string; done: number; total: number } | null;
}) {
  const router = useRouter();
  const settings = useSettings();
  const { startRun } = useWorkQueue();
  const [scope, setScope] = useState<Scope>(scopes.run ? "run" : scopes.from ? "from" : "whole");
  const [slots, setSlots] = useState<"header" | "footer" | "both">("header");
  const [useRefs, setUseRefs] = useState(false);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: RunOptions = useMemo(() => ({ slots, useRefs, suggestModel: usableRef(settings, model) }), [slots, useRefs, settings, model]);
  const tasks = useMemo(() => {
    const chapters = scope === "run" ? (scopes.run?.chapters ?? []) : scope === "from" ? (scopes.from?.chapters ?? []) : scopes.whole;
    return planPictures(chapters, options);
  }, [scope, scopes, options]);
  const estimate = estimatePictures(tasks);
  const noComfy = !settings.comfy.url.trim();
  const tooMany = tasks.length > LIMITS.runTasks;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A run for part of the story starts at that chapter; the whole story, or a run's chapters, at none.
        body: JSON.stringify({ story_id: storyId, start_chapter_id: scope === "from" ? (scopes.from?.id ?? null) : null, mode: "pictures", options, tasks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.id !== "string") throw new Error(data.error ?? `Couldn't start the run (${res.status})`);
      router.replace(`/s/${storyId}/pictures?picrun=${data.id}`);
      await startRun(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function stopUnfinished(id: string) {
    setBusy(true);
    try {
      const token = `stop-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      await finish(await claim(id, token), "stopped", token);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (runId) return <AiRunProgress runId={runId} backHref={`/s/${storyId}/pictures`} backLabel="Make more pictures" />;

  return (
    <>
      {unfinished && (
        <section className="write-ahead-unfinished" aria-label="Unfinished run">
          <p>
            A picture run for this story is unfinished: {unfinished.done} of {unfinished.total} done.
          </p>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                router.replace(`/s/${storyId}/pictures?picrun=${unfinished.id}`);
                void startRun(unfinished.id);
              }}
            >
              Resume
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void stopUnfinished(unfinished.id)}>
              Stop it
            </button>
          </div>
        </section>
      )}

      <form
        className="write-ahead-form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <fieldset>
          <legend>Which chapters</legend>
          <label className="inline-label">
            <input type="radio" name="scope" style={{ width: "auto" }} checked={scope === "whole"} onChange={() => setScope("whole")} />
            <span>The whole story ({scopes.whole.length} chapters)</span>
          </label>
          {scopes.from && (
            <label className="inline-label">
              <input type="radio" name="scope" style={{ width: "auto" }} checked={scope === "from"} onChange={() => setScope("from")} />
              <span>
                “{scopes.from.title}” and everything below it ({scopes.from.chapters.length} chapters)
              </span>
            </label>
          )}
          {scopes.run && (
            <label className="inline-label">
              <input type="radio" name="scope" style={{ width: "auto" }} checked={scope === "run"} onChange={() => setScope("run")} />
              <span>The chapters the write-ahead run wrote ({scopes.run.chapters.length} chapters)</span>
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Pictures</legend>
          {(
            [
              ["header", "Header pictures"],
              ["footer", "Footer pictures"],
              ["both", "Both"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="inline-label">
              <input type="radio" name="slots" style={{ width: "auto" }} checked={slots === value} onChange={() => setSlots(value)} />
              <span>{text}</span>
            </label>
          ))}
          <p className="meta">Only chapters without that picture get one; the ones you made or chose are kept.</p>
        </fieldset>

        <label className="inline-label" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" style={{ width: "auto", marginTop: "0.2rem" }} checked={useRefs} onChange={(e) => setUseRefs(e.target.checked)} />
          <span>
            Use reference pictures{" "}
            <small>
              (the story&apos;s style picture, and for a footer the chapter&apos;s header; the drawing preset must support them, and if it doesn&apos;t the pictures are made without)
            </small>
          </span>
        </label>

        <label>
          Model for prompts <small>(the cheaper model by default)</small>
          <ModelPicker label="Model for prompts" role="cheap" use="suggest" value={model} onChange={setModel} />
        </label>

        {noComfy && (
          <p className="error">
            ComfyUI isn&apos;t set up. Add its address in <Link href="/settings#comfyui">Settings</Link> to make pictures.
          </p>
        )}
        {estimate.pictures === 0 ? (
          <p className="meta">Every chapter here already has {slots === "both" ? "both pictures" : `its ${slots} picture`}. There is nothing to make.</p>
        ) : (
          <p className="meta" aria-live="polite">
            Makes {estimate.pictures} {estimate.pictures === 1 ? "picture" : "pictures"}, one at a time, with {estimate.requests} prompt {estimate.requests === 1 ? "request" : "requests"}.
          </p>
        )}
        {tooMany && <p className="error">That is more than {LIMITS.runTasks} pictures, the most one run can hold. Choose fewer chapters.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ alignItems: "center" }}>
          <button type="submit" disabled={busy || noComfy || estimate.pictures === 0 || tooMany}>
            Start
          </button>
        </div>
      </form>
    </>
  );
}
