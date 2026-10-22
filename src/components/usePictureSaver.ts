"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savedPictureApi, slotsFor, type PictureSlot, type PictureTarget } from "@/lib/pictureTarget";
import { prepareImage } from "@/lib/prepareImage";
import { fetchImage, type ComfyImage } from "@/lib/comfy/client";

// Saved pictures keep at most this many pixels on their longest side, like uploads.
const MAX_SIDE = 1600;

export const SLOT_NAMES: Record<PictureSlot, string> = { header: "header picture", footer: "footer picture", cover: "cover", codex: "codex picture" };

/** Whose slot it is, in words: "the chapter's header picture", "the story's cover". */
export const slotOf = (slot: PictureSlot) =>
  slot === "cover" ? "the story's cover" : slot === "codex" ? "the entry's codex picture" : `the chapter's ${SLOT_NAMES[slot]}`;

/** Where a codex picture starts: the chapter it is saved from (and its descendants), or null for the whole story. */
export type SaveAnchor = { id: string | null; /** In words, for the menu: "from the start", "from “Title” on". */ words: string };

export type PictureSaver = {
  /** The slots pictures can be saved in here: the chapter's header and footer, the story's cover, or the entry's picture. */
  slots: readonly PictureSlot[];
  /** The ways a picture can be saved in a slot: one, except for a codex picture (from the start, or from the chapter the author came from). */
  anchors: (slot: PictureSlot) => SaveAnchor[];
  /** The tile being saved ("<tile key>-<slot>-<anchor id>"), or null. */
  saving: string | null;
  use: (tileKey: string, image: ComfyImage, jobId: string | null, index: number, slot: PictureSlot, anchor?: SaveAnchor) => Promise<void>;
};

/** The words for a chapter a codex picture can start from. */
const shortTitle = (title: string) => (title.length > 30 ? `${title.slice(0, 29).trimEnd()}…` : title);

/**
 * Saves one of ComfyUI's pictures as the chapter's header or footer, as the story's cover, or as a codex
 * entry's picture. `jobId` is the picture job's record in StoryTime, which lets it keep the prompt with the
 * picture, and `index` which of the job's pictures it is, so the page can mark it as in use. Progress and
 * errors go to `report`. `from` is the chapter a codex page was opened from (`?at=`), which a codex picture
 * can start at instead of the start of the story.
 */
export function usePictureSaver(
  target: PictureTarget,
  comfyUrl: string,
  report: (status: { ok: boolean; text: string } | null) => void,
  /** A saved picture is pinned by the server; this is told which one, so the page can show it. */
  onPinned?: (jobId: string, index: number) => void,
  from: { id: string; title: string } | null = null,
): PictureSaver {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  const anchors = (slot: PictureSlot): SaveAnchor[] =>
    slot === "codex"
      ? [{ id: null, words: "from the start" }, ...(from ? [{ id: from.id, words: `from “${shortTitle(from.title)}” on` }] : [])]
      : [{ id: null, words: "" }];

  async function use(tileKey: string, image: ComfyImage, jobId: string | null, index: number, slot: PictureSlot, anchor: SaveAnchor = { id: null, words: "" }) {
    setSaving(`${tileKey}-${slot}-${anchor.id ?? ""}`);
    report(null);
    try {
      const blob = await prepareImage(await fetchImage(comfyUrl, image), MAX_SIDE);
      const api = savedPictureApi(target, slot);
      const query = [jobId ? `job=${encodeURIComponent(jobId)}&index=${index}` : "", target.kind === "codex" && anchor.id ? `anchor=${encodeURIComponent(anchor.id)}` : ""].filter(Boolean).join("&");
      const url = query ? `${api}${api.includes("?") ? "&" : "?"}${query}` : api;
      const res = await fetch(url, { method: target.kind === "codex" ? "POST" : "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the picture (${res.status})`);
      if (jobId) onPinned?.(jobId, index);
      report({ ok: true, text: `Saved as ${slot === "cover" ? "the story's cover" : slot === "codex" ? `the codex picture, ${anchor.words}` : `the ${SLOT_NAMES[slot]}`}.` });
      router.refresh();
    } catch (e) {
      report({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }

  return { slots: slotsFor(target), anchors, saving, use };
}
