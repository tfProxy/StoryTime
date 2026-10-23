"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RefineCanvas, { type RefineCanvasHandle } from "./RefineCanvas";
import { MaskPanel, PaintPanel } from "./refine/RefinePanels";
import { RedoIcon, UndoIcon } from "./refine/RefineIcons";
import { useSettings } from "@/lib/settings";
import { targetHref } from "@/lib/pictureTarget";
import type { MaskStroke } from "@/lib/mask";
import type { PaintStroke } from "@/lib/paint";
import {
  addMaskStroke,
  addPaintStroke,
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
import { deleteSession, loadSession, pruneSessions, saveSession, type RefineSession } from "@/lib/refine/session";
import { pictureOfOriginal } from "@/lib/refine/original";
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
  }, [history, saveNow]);
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

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typingInField(e.target)) return;
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
  }, [doUndo, doRedo]);

  const picture = useMemo(() => (session ? pictureOfOriginal(session.original, session.target, comfy.url) : null), [session, comfy.url]);

  function cancel() {
    if (!session) return;
    if (history && history.past.length > 0 && !window.confirm("Discard your changes?")) return;
    left.current = true;
    deleteSession(session.id);
    router.push(targetHref(session.target));
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
          />
        </div>
        <div className="refine-bar" role="group" aria-label="Undo and finish">
          <button type="button" className="refine-icon secondary" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo(history)} onClick={doUndo}>
            <UndoIcon />
          </button>
          <button type="button" className="refine-icon secondary" aria-label="Redo" title="Redo (Shift+Ctrl+Z)" disabled={!canRedo(history)} onClick={doRedo}>
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
        <RefineCanvas
          key={picture?.key ?? "none"}
          ref={canvas}
          picture={picture}
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
      </div>
    </div>
  );
}
