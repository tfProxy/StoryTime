"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savedPictureApi, slotsFor,type PictureSlot, type PictureTarget } from "@/lib/pictureTarget";
import { prepareImage } from "@/lib/prepareImage";
import { fetchImage, type ComfyImage } from "@/lib/comfy/client";

// Saved pictures keep at most this many pixels on their longest side, like uploads.
const MAX_SIDE = 1600;

export const SLOT_NAMES: Record<PictureSlot, string> = { header: "header picture", footer: "footer picture", cover: "cover" };

/** Whose slot it is, in words: "the chapter's header picture", "the story's cover". */
export const slotOf = (slot: PictureSlot) => (slot === "cover" ? "the story's cover" : `the chapter's ${SLOT_NAMES[slot]}`);

export type PictureSaver = {
  /** The slots pictures can be saved in here: the chapter's header and footer, or the story's cover. */
  slots: readonly PictureSlot[];
  /** The tile being saved ("<tile key>-<slot>"), or null. */
  saving: string | null;
  use: (tileKey: string, image: ComfyImage, jobId: string | null, index: number, slot: PictureSlot) => Promise<void>;
};

/**
 * Saves one of ComfyUI's pictures as the chapter's header or footer, or as the story's cover. `jobId` is
 * the picture job's record in StoryTime, which lets it keep the prompt with the picture, and `index` which
 * of the job's pictures it is, so the page can mark it as in use. Progress and errors go to `report`.
 */
export function usePictureSaver(
  target: PictureTarget,
  comfyUrl: string,
  report: (status: { ok: boolean; text: string } | null) => void,
  /** A saved picture is pinned by the server; this is told which one, so the page can show it. */
  onPinned?: (jobId: string, index: number) => void,
): PictureSaver {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  async function use(tileKey: string, image: ComfyImage, jobId: string | null, index: number, slot: PictureSlot) {
    setSaving(`${tileKey}-${slot}`);
    report(null);
    try {
      const blob = await prepareImage(await fetchImage(comfyUrl, image), MAX_SIDE);
      const made = jobId ? `?job=${encodeURIComponent(jobId)}&index=${index}` : "";
      const res = await fetch(`${savedPictureApi(target, slot)}${made}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the picture (${res.status})`);
      if (jobId) onPinned?.(jobId, index);
      report({ ok: true, text: `Saved as ${slot === "cover" ? "the story's cover" : `the ${SLOT_NAMES[slot]}`}.` });
      router.refresh();
    } catch (e) {
      report({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }

  return { slots: slotsFor(target), saving, use };
}
