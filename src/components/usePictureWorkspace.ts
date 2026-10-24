"use client";

import { useCallback, useEffect, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from "react";
import type { LoadedPrompt } from "./ImagePromptPanel";
import { markJobsSeen } from "./PictureQueue";
import { picturesOf, type PendingJob, type Picture, type PromptToLoad, type StartRequest } from "./pictures";
import { editBlocked, useEditModels } from "./useEditModels";
import { useSettings } from "@/lib/settings";
import type { PictureJob } from "@/lib/pictureJobs";
import { chapterIdOf, entryIdOf, targetOfIds, type PictureSlot, type PictureTarget } from "@/lib/pictureTarget";
import { fromComfyImage, fromSaved, type StartPicture } from "@/lib/comfy/startPicture";
import { asReference, type ReferenceRole } from "@/lib/comfy/references";
import type { RefRequest } from "./useReferences";
import { readLoras, readStart, stateKey, writeStart } from "@/lib/comfy/editingState";
import { newSession, originalOf, saveSession } from "@/lib/refine/session";
import { useRouter } from "next/navigation";

/** The narrowest the controls column can be dragged to, the widest as a share of the page, and the handle's width (see .column-resizer). */
const MIN_CONTROLS = 320;
const MAX_CONTROLS_SHARE = 0.6;
const HANDLE_PX = 16;

/**
 * What a page that makes pictures (a chapter's Illustrate page, the story's cover page) keeps for its two
 * columns: the prompt loaded from a picture (each load carries a number, so loading the same prompt twice
 * still counts as a new request), the starting picture for the Instruct edit (kept in this
 * browser), the pictures (those made earlier, then those made on this visit), the jobs being made, and
 * the width the controls column was dragged to. `versions` are the saved pictures' versions, which a
 * starting picture may be.
 */
export function usePictureWorkspace(target: PictureTarget, jobs: PictureJob[], versions: Partial<Record<PictureSlot, number | null>>) {
  const [loaded, setLoaded] = useState<LoadedPrompt | null>(null);
  // A picture chosen with "Use as reference", for the prompt panel to add to its References (a new `nonce` for each).
  const [refRequest, setRefRequest] = useState<RefRequest | null>(null);
  // The picture the Instruct edit starts from, when one is chosen.
  const [start, setStart] = useState<StartPicture | null>(null);
  const router = useRouter();
  const comfy = useSettings().comfy;
  const editModels = useEditModels(comfy.url);
  const blocked = editBlocked(editModels, comfy.editPresets);
  // The pictures, newest first.
  const [pictures, setPictures] = useState<Picture[]>(() => picturesOf(jobs));
  // Jobs that finished while the page wasn't open show as new (fresh) this once.
  useEffect(() => markJobsSeen(jobs.filter((j) => j.seen_at === null).map((j) => j.id)), [jobs]);
  // The jobs being made, newest first, shown among the pictures.
  const [pending, setPending] = useState<PendingJob[]>([]);
  // The starting picture is kept in this browser, so a refresh brings it back. It is read once
  // ComfyUI's address is known (the settings load after the page), and written only after that.
  const kept = stateKey(target);
  // The target is rebuilt each render, so what is used below is its ids.
  const { storyId } = target;
  const chapterId = chapterIdOf(target);
  const entryId = entryIdOf(target);
  const [restored, setRestored] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- browser storage can only be read after the page is shown, so the server and browser draw the same first page */
  useEffect(() => {
    if (restored || !comfy.url) return;
    const saved = readStart(kept);
    const version = saved?.slot ? versions[saved.slot] : null;
    let picture: StartPicture | null = null;
    if (saved?.image) picture = fromComfyImage(comfy.url, saved.image);
    else if (saved?.slot && version) picture = fromSaved(targetOfIds(storyId, chapterId, entryId), saved.slot, version);
    if (picture) setStart(picture);
    setRestored(true);
  }, [restored, comfy.url, kept, storyId, chapterId, entryId, versions]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!restored) return;
    writeStart(kept, start && (start.image || start.slot) ? { mode: "edit", image: start.image, slot: start.slot } : null);
  }, [restored, kept, start]);

  function load(p: PromptToLoad) {
    setLoaded({ ...p, nonce: (loaded?.nonce ?? 0) + 1 });
    // On a phone the prompt box is far above the pictures.
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** `as` says what a picture added to the References is called and what it shows (a codex entry's picture knows). */
  function startFrom(picture: StartPicture, request: StartRequest, as?: { label: string; role: ReferenceRole }) {
    if (request === "refine") {
      // Not a starting picture: a Refine session is made for the picture and the Refine screen opens.
      const original = originalOf(picture);
      const made = picture.image && pictures.find((p) => p.image.filename === picture.image!.filename && p.image.subfolder === picture.image!.subfolder);
      const session = original && newSession({ target, original, prompt: made?.prompt, negative: made?.negative, loras: readLoras(kept) });
      if (!session || !saveSession(session)) {
        window.alert("Couldn't open the Refine screen: this picture can't be fetched again, or the browser won't keep the session.");
        return;
      }
      router.push(`/refine/${session.id}`);
      return;
    }
    if (request === "reference") {
      // Not a starting picture: the picture joins the References, where the prompt panel takes it from here.
      const label = as?.label ?? (picture.slot === "header" ? "Header" : picture.slot === "footer" ? "Footer" : picture.slot === "cover" ? "Cover" : "Picture");
      setRefRequest((prev) => ({ ref: asReference(picture, label, as?.role ?? "character"), nonce: (prev?.nonce ?? 0) + 1 }));
      document.getElementById("picture-references")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setStart(picture);
    document.getElementById("picture-prompt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // A job that finished while the page was away may already be listed (the page loaded after it was
  // recorded); it is new all the same.
  function addPictures(made: Picture[]) {
    setPictures((prev) => {
      const byKey = new Map(made.map((m) => [m.key, m]));
      const listed = new Set(prev.filter((p) => byKey.has(p.key)).map((p) => p.key));
      const again = (p: Picture) => ({ ...p, fresh: true, isNew: p.isNew || byKey.get(p.key)!.isNew });
      return [...made.filter((m) => !listed.has(m.key)), ...prev.map((p) => (byKey.has(p.key) ? again(p) : p))];
    });
  }
  // Pictures loaded from the log on request (the temporary ones): added as they are, those listed already left alone.
  const addLoaded = useCallback(
    (loaded: Picture[]) =>
      setPictures((prev) => {
        const listed = new Set(prev.map((p) => p.key));
        const more = loaded.filter((p) => !listed.has(p.key));
        return more.length ? [...prev, ...more].sort((a, b) => b.madeAt - a.madeAt) : prev;
      }),
    [],
  );
  // Any change to a picture (pinning, trashing…) means it has been looked at, so it is no longer marked new.
  const changePicture = (key: string, patch: Partial<Picture>) => setPictures((prev) => prev.map((p) => (p.key === key ? { ...p, isNew: false, ...patch } : p)));
  const clearFresh = () => setPictures((prev) => prev.map((p) => (p.fresh ? { ...p, fresh: false } : p)));

  // Size, Queue and the queue's status are put in this element (see ComfyGenerate), so they stay at the bottom of the screen.
  const [dock, setDock] = useState<HTMLElement | null>(null);

  // EXPERIMENT: the width the author dragged the controls column to (px), or null for the default; wide screens only.
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [controlsWidth, setControlsWidth] = useState<number | null>(null);
  const fit = (px: number) => Math.round(Math.min(Math.max(px, MIN_CONTROLS), (grid?.clientWidth ?? 1600) * MAX_CONTROLS_SHARE));

  function drag(e: PointerEvent<HTMLDivElement>) {
    if (!grid || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const left = grid.getBoundingClientRect().left;
    const move = (ev: globalThis.PointerEvent) => setControlsWidth(fit(ev.clientX - left - HANDLE_PX / 2));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const now = controlsWidth ?? grid?.querySelector<HTMLElement>(".illustrate-controls")?.offsetWidth ?? MIN_CONTROLS;
      setControlsWidth(fit(now + (e.key === "ArrowRight" ? 24 : -24)));
    } else if (e.key === "Home" || e.key === "Escape") {
      setControlsWidth(null);
    }
  }

  /** The grid's own props: its ref, and the dragged width. */
  const gridProps = { ref: setGrid, style: controlsWidth ? ({ "--controls-width": `${controlsWidth}px` } as CSSProperties) : undefined };
  /** The handle between the columns. */
  const resizerProps: HTMLAttributes<HTMLDivElement> = {
    className: "column-resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Column divider",
    title: "Drag to resize the columns; double-click to reset",
    tabIndex: 0,
    onPointerDown: drag,
    onDoubleClick: () => setControlsWidth(null),
    onKeyDown: nudge,
  };

  return {
    comfy, editModels, blocked, loaded, load, refRequest, start, setStart, startFrom,
    pictures, addPictures, addLoaded, changePicture, clearFresh, pending, setPending, dock, setDock, gridProps, resizerProps,
  };
}
