// A picture chosen to start a job from (image to image), and getting it into ComfyUI. Browser code.
import { chapterImageUrl, type ImageSlot } from "../imageSlots";
import { fetchImage, imageUrl, uploadImage, type ComfyImage } from "./client";

export type StartPicture = {
  /** Tells pictures apart, so one that is already in ComfyUI isn't uploaded again. */
  key: string;
  /** Where the browser can show it, as a thumbnail. */
  thumb: string;
  /** Where it came from, as kept in the job log. */
  source: string;
  /** Fetches the picture itself. */
  blob: () => Promise<Blob>;
};

/** One of ComfyUI's own pictures (a new or a past one). */
export function fromComfyImage(comfyUrl: string, image: ComfyImage): StartPicture {
  const source = `comfy:${image.subfolder ? `${image.subfolder}/` : ""}${image.filename}`;
  return { key: source, thumb: imageUrl(comfyUrl, image), source, blob: () => fetchImage(comfyUrl, image) };
}

/** A chapter's saved header or footer picture; `version` is its current version. */
export function fromSaved(chapterId: string, slot: ImageSlot, version: number): StartPicture {
  const thumb = chapterImageUrl(chapterId, slot, version);
  return {
    key: `saved:${chapterId}:${slot}:${version}`,
    thumb,
    source: `saved:${chapterId}:${slot}`,
    blob: async () => {
      const res = await fetch(thumb);
      if (!res.ok) throw new Error(`Couldn't read the saved ${slot} picture (${res.status}).`);
      return res.blob();
    },
  };
}

export type Uploaded = { key: string; name: string; width: number; height: number };

/** Uploads the starting picture to ComfyUI and reads its size, which is the size of the pictures made from it. */
export async function uploadStart(comfyUrl: string, start: StartPicture): Promise<Uploaded> {
  const blob = await start.blob();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  const ext = blob.type === "image/jpeg" ? "jpg" : "png";
  const name = await uploadImage(comfyUrl, blob, `storytime-start-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  return { key: start.key, name, width, height };
}
