"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImageSlot } from "@/lib/imageSlots";
import { prepareImage } from "@/lib/prepareImage";
import { fetchImage, type ComfyImage } from "@/lib/comfy/client";

// Saved pictures keep at most this many pixels on their longest side, like uploads.
const MAX_SIDE = 1600;

export const SLOT_NAMES: Record<ImageSlot, string> = { header: "header picture", footer: "footer picture" };

export type PictureSaver = {
  /** The tile being saved ("<tile key>-<slot>"), or null. */
  saving: string | null;
  use: (tileKey: string, image: ComfyImage, jobId: string | null, slot: ImageSlot) => Promise<void>;
};

/**
 * Saves one of ComfyUI's pictures as the chapter's header or footer. `jobId` is the picture job's record in
 * StoryTime, which lets it keep the prompt with the picture. Progress and errors go to `report`.
 */
export function usePictureSaver(chapterId: string, comfyUrl: string, report: (status: { ok: boolean; text: string } | null) => void): PictureSaver {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  async function use(tileKey: string, image: ComfyImage, jobId: string | null, slot: ImageSlot) {
    setSaving(`${tileKey}-${slot}`);
    report(null);
    try {
      const blob = await prepareImage(await fetchImage(comfyUrl, image), MAX_SIDE);
      const made = jobId ? `?job=${encodeURIComponent(jobId)}` : "";
      const res = await fetch(`/api/chapters/${chapterId}/images/${slot}${made}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the picture (${res.status})`);
      report({ ok: true, text: `Saved as the ${SLOT_NAMES[slot]}.` });
      router.refresh();
    } catch (e) {
      report({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  }

  return { saving, use };
}
