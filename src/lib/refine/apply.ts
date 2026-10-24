// Making a result the working picture (Apply). Browser code, except the two small helpers on top.
import { fetchImage, uploadImage, type ComfyImage } from "../comfy/client";
import type { StoredOriginal } from "./session";

/** Whether a picture of `w` x `h` must be resampled to be the working picture's size. */
export const sizeDiffers = (w: number, h: number, size: { w: number; h: number }) => w !== size.w || h !== size.h;

/** The picture ComfyUI's /upload/image answered with: `name` with its subfolder in front when it has one. */
export function uploadedImage(name: string): ComfyImage {
  const i = name.lastIndexOf("/");
  return { filename: name.slice(i + 1), subfolder: i < 0 ? "" : name.slice(0, i), type: "input" };
}

/**
 * Where a result is fetched from as the working picture. A result of the working picture's size is used as it is. A
 * result of another size (some model families round the size to a multiple of 16) is resampled to the working
 * picture's size and uploaded to ComfyUI's input folder, so the mask and the paint stay aligned with it.
 */
export async function baseForResult(comfyUrl: string, image: ComfyImage, size: { w: number; h: number }): Promise<StoredOriginal> {
  const blob = await fetchImage(comfyUrl, image);
  const bitmap = await createImageBitmap(blob);
  try {
    if (!sizeDiffers(bitmap.width, bitmap.height, size)) return { kind: "comfy", image: { filename: image.filename, subfolder: image.subfolder, type: image.type } };
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize the picture.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.w, size.h);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't make the resized picture."))), "image/png"));
    const name = await uploadImage(comfyUrl, png, `storytime-refine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`);
    return { kind: "comfy", image: uploadedImage(name) };
  } finally {
    bitmap.close();
  }
}
