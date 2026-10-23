// Gets a Refine session's picture again from where it came from. Browser code.
import type { PictureTarget } from "../pictureTarget";
import { fromCodex, fromComfyImage, fromSaved, type StartPicture } from "../comfy/startPicture";
import type { StoredOriginal } from "./session";

/** The picture an original names; a ComfyUI picture needs ComfyUI's address (null until it is known). */
export function pictureOfOriginal(original: StoredOriginal, target: PictureTarget, comfyUrl: string): StartPicture | null {
  if (original.kind === "comfy") return comfyUrl ? fromComfyImage(comfyUrl, original.image) : null;
  if (original.kind === "codex") return fromCodex(target.storyId, original.pictureId);
  return fromSaved(target, original.slot, original.version);
}
