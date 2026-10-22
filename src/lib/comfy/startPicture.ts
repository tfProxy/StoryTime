// A picture chosen to start a job from (image to image), and getting it into ComfyUI. Browser code.
import { codexPictureUrl, savedOwner, savedPictureUrl, type PictureSlot, type PictureTarget } from "../pictureTarget";
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
  /** Which one it is, so the choice can be remembered across a refresh: ComfyUI's picture, or the saved slot. */
  image?: ComfyImage;
  slot?: PictureSlot;
};

/** One of ComfyUI's own pictures (a new or a past one). */
export function fromComfyImage(comfyUrl: string, image: ComfyImage): StartPicture {
  const source = `comfy:${image.subfolder ? `${image.subfolder}/` : ""}${image.filename}`;
  return { key: source, thumb: imageUrl(comfyUrl, image), source, blob: () => fetchImage(comfyUrl, image), image };
}

/** A codex entry's saved picture (`codex:<picture id>`); a picture never changes once saved. */
export function fromCodex(storyId: string, pictureId: string): StartPicture {
  const thumb = codexPictureUrl(storyId, pictureId);
  return {
    key: `codex:${pictureId}`,
    thumb,
    source: `codex:${pictureId}`,
    blob: async () => {
      const res = await fetch(thumb);
      if (!res.ok) throw new Error(`Couldn't read the saved codex picture (${res.status}).`);
      return res.blob();
    },
  };
}

/**
 * A chapter's saved header or footer picture, or the story's saved cover (`saved:<story id>:cover`);
 * `version` is its current version.
 */
export function fromSaved(target: PictureTarget, slot: PictureSlot, version: number): StartPicture {
  const thumb = savedPictureUrl(target, slot, version);
  const owner = savedOwner(target);
  return {
    key: `saved:${owner}:${slot}:${version}`,
    thumb,
    source: `saved:${owner}:${slot}`,
    slot,
    blob: async () => {
      const res = await fetch(thumb);
      if (!res.ok) throw new Error(`Couldn't read the saved ${slot === "cover" ? "cover" : `${slot} picture`} (${res.status}).`);
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
