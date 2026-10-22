// Reference pictures: pictures a job is shown so that a character, an item, a place or a style comes back
// (through IP-Adapter in the drawing workflows, and as extra images for the edit models). Browser code,
// built from a picture the same ways as a starting picture.
import { fromComfyImage, fromSaved, type StartPicture } from "./startPicture";
import { uploadImage } from "./client";

export const REFERENCE_ROLES = ["character", "item", "place", "style"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

/** A job takes at most this many reference pictures. */
export const MAX_REFERENCES = 4;

/** How strongly each kind of reference is followed, unless the author changes it. */
export const DEFAULT_WEIGHTS: Record<ReferenceRole, number> = { character: 0.7, item: 0.6, place: 0.5, style: 0.8 };

/** The part of a reference that is recorded in the job log and the job's tag. */
export type StoredReference = {
  /** Where the picture came from, as in the job log (`comfy:<file>`, `saved:<id>:<slot>`). */
  source: string;
  label: string;
  role: ReferenceRole;
  weight: number;
};

export type Reference = StoredReference & {
  /** Tells pictures apart, so one that is already in ComfyUI isn't uploaded again. */
  key: string;
  /** Where the browser can show it, as a thumbnail. */
  thumb: string;
  /** Fetches the picture itself. */
  blob: () => Promise<Blob>;
};

/** A picture chosen as a reference, with a label, a role and (by default, the role's) weight. */
export function asReference(start: StartPicture, label: string, role: ReferenceRole, weight: number = DEFAULT_WEIGHTS[role]): Reference {
  return { key: start.key, thumb: start.thumb, source: start.source, blob: start.blob, label, role, weight };
}

export { fromComfyImage, fromSaved };

/** What is recorded about a job's references. */
export const storedOf = (refs: Reference[] | undefined): StoredReference[] =>
  (refs ?? []).map(({ source, label, role, weight }) => ({ source, label, role, weight }));

/** A reference's text in the job's details: “Jim (character 0.7)”. */
export const referenceText = (r: StoredReference) => `${r.label} (${r.role} ${r.weight})`;

/** A reference's upload to ComfyUI, kept by key so the next job with it doesn't send it again. */
const uploads = new Map<string, Promise<string>>();

/** Uploads the reference once per ComfyUI address and picture; its name in ComfyUI's input folder. */
export function uploadReference(comfyUrl: string, ref: Reference): Promise<string> {
  const key = `${comfyUrl}\n${ref.key}`;
  const cached = uploads.get(key);
  if (cached) return cached;
  const name = (async () => {
    const blob = await ref.blob();
    const ext = blob.type === "image/jpeg" ? "jpg" : "png";
    return uploadImage(comfyUrl, blob, `storytime-ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  })();
  uploads.set(key, name);
  // the next job tries the upload again
  name.catch(() => {
    if (uploads.get(key) === name) uploads.delete(key);
  });
  return name;
}
