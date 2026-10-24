"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RefineCanvas, { type RefineCanvasHandle } from "./RefineCanvas";
import { MaskPanel, PaintPanel } from "./refine/RefinePanels";
import RefinePromptPanel from "./refine/RefinePromptPanel";
import RefineResults from "./refine/RefineResults";
import { usePictureQueue } from "./PictureQueue";
import { RedoIcon, UndoIcon } from "./refine/RefineIcons";
import { useSettings } from "@/lib/settings";
import { targetHref } from "@/lib/pictureTarget";
import type { MaskStroke } from "@/lib/mask";
import type { PaintStroke } from "@/lib/paint";
import {
  addMaskStroke,
  addPaintStroke,
  applyResult,
  canRedo,
  canUndo,
  commit,
  redo,
  setMask,
  toggleMaskVisible,
  togglePaintVisible,
  undo,
  type History,
  type RefineState,
} from "@/lib/refineHistory";
import { addResults, appliedSource, baseOf, deleteSession, discardResult, loadSession, neighbour, pruneSessions, resultBaseId, resultKey, saveSession, type RefineSession } from "@/lib/refine/session";
import { pictureOfOriginal } from "@/lib/refine/original";
import { baseForResult } from "@/lib/refine/apply";
import { fromComfyImage } from "@/lib/comfy/startPicture";
import { NextIcon, PreviousIcon } from "./refine/RefineIcons";
import { defaultMaskSize, DEFAULT_TOOLS, loadTools, maxMaskSize, maxSoftEdge, saveTools, type RefineTool, type ToolSettings } from "@/lib/refine/tools";

/** How long a change waits before the session is saved (it is also saved when the page is left). */
const SAVE_MS = 300;

/** Whether a key press is for typing into a field (the undo keys then belong to the field). */
function typingInField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.tagName !== "INPUT") return false;
  return !["range", "checkbox", "radio", "button"].includes((t as HTMLInputElement).type);
}

/**
 * The Refine screen: the tools on the left (the mask, the paint, and the Undo / Accept / Cancel bar) and the
 * picture on the right. The session (the picture's origin and the editor's undo history) is kept in this
 * browser, so reloading the page brings everything back.
 */
export default function RefineScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const comfy = useSettings().comfy;
  const [phase, setPhase] = useState<"loading" | "missing" | "ready">("loading");
  const [session, setSession] = useState<RefineSession | null>(null);
  const [history, setHistory] = useState<History<RefineState> | null>(null);
  const [tool, setTool] = useState<RefineTool>("paint-brush");
  const [tools, setTools] = useState<ToolSettings>(DEFAULT_TOOLS);
  const [softPreview, setSoftPreview] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  /** The result on show in the main window (its `resultKey`), or null while editing. Not part of the undo history and not kept. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const queue = usePictureQueue();
  const { listenSession, stop } = queue;
  const canvas = useRef<RefineCanvasHandle>(null);
  const sessionRef = useRef<RefineSession | null>(null);
  const historyRef = useRef<History<RefineState> | null>(null);
  const toolsReady = useRef(false);
  const left = useRef(false);

  // Browser storage can only be read after the page is shown, so the server and the browser draw the same first page.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    pruneSessions();
    const s = loadSession(sessionId);
    if (s) {
      sessionRef.current = s;
      historyRef.current = s.history;
      setSession(s);
      setHistory(s.history);
      setTools(loadTools());
      toolsReady.current = true;
      setPhase("ready");
    } else {
      setPhase("missing");
    }
  }, [sessionId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The last brush settings are kept for the next session.
  useEffect(() => {
    if (toolsReady.current) saveTools(tools);
  }, [tools]);

  // Every committed change is saved after a short pause, and at once when the page is left.
  const saveNow = useCallback(() => {
    const s = sessionRef.current;
    const h = historyRef.current;
    if (!s || !h || left.current) return;
    saveSession({ ...s, history: h });
  }, []);
  useEffect(() => {
    if (!history) return;
    historyRef.current = history;
    const t = setTimeout(saveNow, SAVE_MS);
    return () => clearTimeout(t);
  }, [history, session, saveNow]);
  // A change to the session itself (the prompt boxes, the LoRAs, the results).
  const patchSession = useCallback((f: (s: RefineSession) => RefineSession) => {
    const s = sessionRef.current;
    if (!s) return;
    const next = f(s);
    sessionRef.current = next;
    setSession(next);
  }, []);
  // The pictures this session's jobs make come here, and to no other page (see `listenSession`).
  useEffect(() => {
    if (phase !== "ready") return;
    return listenSession(sessionId, {
      onPictures: (pictures, { base }) => {
        const at = Date.now();
        patchSession((s) => ({
          ...s,
          results: addResults(s.results, pictures.map((p) => ({ image: p.image, prompt: p.prompt, negative: p.negative, seed: p.seed, madeFrom: base, at }))),
        }));
        setStatus((st) => (st?.text === "Queued…" ? null : st));
      },
      onStatus: setStatus,
    });
  }, [phase, sessionId, listenSession, patchSession]);
  useEffect(() => {
    window.addEventListener("pagehide", saveNow);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      saveNow();
    };
  }, [saveNow]);

  const present = history?.present ?? null;
  const change = useCallback((f: (s: RefineState) => RefineState) => setHistory((h) => (h ? commit(h, f(h.present)) : h)), []);
  const doUndo = useCallback(() => setHistory((h) => (h ? undo(h) : h)), []);
  const doRedo = useCallback(() => setHistory((h) => (h ? redo(h) : h)), []);

  // The result on show (null when it is gone, e.g. discarded).
  const results = session?.results;
  const selected = useMemo(() => (selectedKey && results ? (results.find((r) => resultKey(r) === selectedKey) ?? null) : null), [selectedKey, results]);
  const reviewing = selected !== null;
  const previousResult = selected && results ? neighbour(results, selectedKey!, -1) : null;
  const nextResult = selected && results ? neighbour(results, selectedKey!, 1) : null;
  const selectedImage = selected?.image;
  const preview = useMemo(() => (selectedImage && comfy.url ? fromComfyImage(comfy.url, selectedImage) : null), [selectedImage, comfy.url]);

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y, unless typing in a field or looking at a result.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typingInField(e.target) || reviewing) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (k === "y" && !e.metaKey) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo, reviewing]);

  // ← and → go to the previous and next result while one is on show (not while typing in a field).
  useEffect(() => {
    if (!selectedKey || !results) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typingInField(e.target)) return;
      // A slider or select uses the arrows itself.
      if (e.target instanceof HTMLElement && (e.target.tagName === "SELECT" || (e.target as HTMLInputElement).type === "range")) return;
      const to = neighbour(results, selectedKey, e.key === "ArrowLeft" ? -1 : 1);
      e.preventDefault();
      if (to) setSelectedKey(resultKey(to));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKey, results]);

  // Depends on the working picture's origin and the target only, so a change to the prompt boxes doesn't make the canvas load the picture again.
  const presentBase = present?.base;
  const original = session && presentBase ? baseOf(session, presentBase).original : undefined;
  const sessionTarget = session?.target;
  const picture = useMemo(() => (original && sessionTarget ? pictureOfOriginal(original, sessionTarget, comfy.url) : null), [original, sessionTarget, comfy.url]);
  const pending = useMemo(
    () => queue.jobs.filter((j) => j.session === sessionId && j.state === "making").map((j) => ({ key: j.key, count: j.count, stop: () => stop(j.key) })),
    [queue.jobs, sessionId, stop],
  );

  function cancel() {
    if (!session) return;
    if (history && history.past.length > 0 && !window.confirm("Discard your changes?")) return;
    left.current = true;
    deleteSession(session.id);
    router.push(targetHref(session.target));
  }

  /** Makes the result on show the working picture (one undo step) and goes back to editing. */
  async function apply() {
    const r = selected;
    const s = sessionRef.current;
    const h = historyRef.current;
    if (!r || !s || !h || !dims || applying) return;
    const id = resultBaseId(r.image);
    setApplying(true);
    setStatus(null);
    try {
      let entry = s.bases[id];
      // A result of another size is resampled to the working picture's size and uploaded (once per result).
      if (!entry) entry = { original: await baseForResult(comfy.url, r.image, dims), prompt: r.prompt, negative: r.negative };
      const stored = entry;
      patchSession((cur) => {
        // The boxes keep the text typed now: while they showed the source, they would change with it.
        const src = appliedSource(cur, (historyRef.current ?? h).present.base);
        return {
          ...cur,
          bases: cur.bases[id] ? cur.bases : { ...cur.bases, [id]: stored },
          boxPrompt: cur.boxPrompt ?? src?.prompt ?? cur.sourcePrompt ?? cur.prompt ?? "",
          boxNegative: cur.boxNegative ?? src?.negative ?? cur.sourceNegative ?? cur.negative ?? "",
        };
      });
      setHistory((cur) => {
        if (!cur) return cur;
        // Applying the picture that is already the working one, with no paint on it, changes nothing.
        if (cur.present.base === id && cur.present.paint.length === 0) return cur;
        return commit(cur, applyResult(cur.present, id));
      });
      setSelectedKey(null);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Couldn't use that picture." });
    } finally {
      setApplying(false);
    }
  }

  /** Removes the result on show from the tray (not undoable) and shows the next one, else the previous, else goes back to editing. */
  function discard() {
    if (!selected) return;
    const key = resultKey(selected);
    const gone = discardResult(session!.results, key);
    patchSession((cur) => ({ ...cur, results: discardResult(cur.results, key).results }));
    setSelectedKey(gone.next);
  }

  const onPaintStroke = useCallback(
    (stroke: PaintStroke) => change((s) => {
      const next = addPaintStroke(s, stroke);
      return next.paintVisible ? next : togglePaintVisible(next);
    }),
    [change],
  );
  const onMaskStroke = useCallback(
    (stroke: MaskStroke) => change((s) => {
      const next = addMaskStroke(s, stroke);
      return next.maskVisible ? next : toggleMaskVisible(next);
    }),
    [change],
  );
  const onPickColor = useCallback((color: string) => setTools((t) => (t.color === color ? t : { ...t, color })), []);

  if (phase === "loading") return <p className="meta" role="status">Loading…</p>;
  if (phase === "missing" || !session || !history || !present) {
    return (
      <>
        <h1>Refine picture</h1>
        <p role="alert">This Refine session isn&rsquo;t here any more. It may have been cancelled, or it was kept in another browser.</p>
        <p>
          <Link href="/">← Back to StoryTime</Link>
        </p>
      </>
    );
  }

  const inUse = session.results.find((r) => resultBaseId(r.image) === present.base) ?? null;
  const w = dims?.w ?? 1024;
  const h = dims?.h ?? 1024;
  const maskSize = tools.maskSize ?? defaultMaskSize(w, h);
  const maxSize = maxMaskSize(w, h);

  return (
    <div className="refine-page" data-session={session.id}>
      <header className="refine-head">
        <h1>Refine picture</h1>
        <button type="button" className="secondary" onClick={cancel} aria-label="Cancel and go back" title="Leave without changing anything">
          Cancel
        </button>
      </header>
      <div className="refine-tools">
        <div className="refine-panels">
          <MaskPanel
            tool={tool}
            onTool={setTool}
            size={maskSize}
            maxSize={maxSize}
            onSize={(v) => {
              setTools((t) => ({ ...t, maskSize: v }));
              setTool((t) => (t.startsWith("mask-") && t !== "mask-lasso" ? t : "mask-brush"));
              canvas.current?.showBrushSize(v);
            }}
            softness={present.mask.softness}
            maxSoft={maxSoftEdge(w, h)}
            onSoftPreview={setSoftPreview}
            onSoftCommit={(v) => change((s) => setMask(s, { softness: v }))}
            inverted={present.mask.inverted}
            onInvert={() => change((s) => setMask(s, { inverted: !s.mask.inverted }))}
            visible={present.maskVisible}
            onToggleVisible={() => change(toggleMaskVisible)}
            disabled={reviewing}
          />
          <PaintPanel
            tool={tool}
            onTool={setTool}
            size={tools.size}
            maxSize={maxSize}
            onSize={(v) => {
              setTools((t) => ({ ...t, size: v }));
              setTool((t) => (t === "airbrush" || t === "paint-eraser" ? t : "paint-brush"));
              canvas.current?.showBrushSize(v);
            }}
            softness={tools.softness}
            onSoftness={(v) => setTools((t) => ({ ...t, softness: v }))}
            opacity={tools.opacity}
            onOpacity={(v) => setTools((t) => ({ ...t, opacity: v }))}
            color={tools.color}
            onColor={(color) => setTools((t) => ({ ...t, color }))}
            visible={present.paintVisible}
            onToggleVisible={() => change(togglePaintVisible)}
            disabled={reviewing}
          />
          <RefinePromptPanel
            session={session}
            onSession={patchSession}
            present={present}
            canvas={canvas}
            picture={picture}
            dims={dims}
            tools={tools}
            onTools={setTools}
            status={status}
            onStatus={setStatus}
            locked={reviewing}
          />
          <RefineResults
            results={session.results}
            pending={pending}
            comfyUrl={comfy.url}
            selectedKey={selected ? selectedKey : null}
            onSelect={setSelectedKey}
            inUseKey={inUse ? resultKey(inUse) : null}
          />
        </div>
        <div className="refine-bar" role="group" aria-label="Undo and finish">
          <button type="button" className="refine-icon secondary" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={reviewing || !canUndo(history)} onClick={doUndo}>
            <UndoIcon />
          </button>
          <button type="button" className="refine-icon secondary" aria-label="Redo" title="Redo (Shift+Ctrl+Z)" disabled={reviewing || !canRedo(history)} onClick={doRedo}>
            <RedoIcon />
          </button>
          <button type="button" className="refine-accept" disabled title="Not available yet">
            Accept
          </button>
          <button type="button" className="refine-cancel" onClick={cancel} title="Throw this away and go back">
            Cancel
          </button>
        </div>
      </div>
      <div className="refine-picture">
        {loadError ? (
          <p className="error" role="alert">
            {loadError}
          </p>
        ) : (
          !dims && (
            <p className="meta" role="status">
              {picture ? "Loading the picture…" : "Waiting for ComfyUI’s address…"}
            </p>
          )
        )}
        <div className="refine-viewer">
        <RefineCanvas
          key={picture?.key ?? "none"}
          ref={canvas}
          picture={picture}
          preview={preview}
          state={present}
          tool={tool}
          settings={tools}
          softPreview={softPreview}
          onPaintStroke={onPaintStroke}
          onMaskStroke={onMaskStroke}
          onPickColor={onPickColor}
          onUndo={doUndo}
          onLoaded={setDims}
          onError={setLoadError}
        />
        {reviewing && (
          <>
            <button
              type="button"
              className="refine-nav refine-nav-previous"
              aria-label="Previous result"
              title="Previous result (←)"
              disabled={!previousResult}
              onClick={() => previousResult && setSelectedKey(resultKey(previousResult))}
            >
              <PreviousIcon />
            </button>
            <button
              type="button"
              className="refine-nav refine-nav-next"
              aria-label="Next result"
              title="Next result (→)"
              disabled={!nextResult}
              onClick={() => nextResult && setSelectedKey(resultKey(nextResult))}
            >
              <NextIcon />
            </button>
          </>
        )}
        </div>
        {reviewing && (
          <div className="refine-review" role="group" aria-label="This result">
            <button type="button" className="refine-apply" aria-label="Apply this result" title="Make this the working picture" disabled={applying || !dims} onClick={apply}>
              {applying ? "Applying…" : "Apply"}
            </button>
            <button type="button" className="refine-discard secondary" aria-label="Discard this result" title="Remove this result from the list" disabled={applying} onClick={discard}>
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
