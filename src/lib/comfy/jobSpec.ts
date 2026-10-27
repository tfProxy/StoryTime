// A job as plain data, so it can be sent to the server: `JobInput` with every closure (the pictures' `blob()`, the
// painted mask) replaced by a source string the server can fetch (see `resolveSource` in `worker/uploads`).
import type { PaintedArea } from "../mask";
import { drawModel } from "./drawModels";
import { editModel } from "./editModels";
import { maskBounds, type Box } from "./inpaintRegion";
import type { JobInput } from "./makeJob";
import type { StoredReference } from "./references";
import type { StartPicture } from "./startPicture";

/** A starting picture without its thumbnail and closure. */
export type SpecStart = Pick<StartPicture, "key" | "source" | "image" | "slot"> & {
  /** Where the server gets the bytes, when that is not `source` (a picture the browser uploaded; `source` is still what the log records). */
  fetch?: string;
};

export type SpecRef = StoredReference & { key: string; fetch?: string };

/** The painted area as the PNG the browser drew and uploaded (`source` is `upload:<id>`); `id` is the `PaintedArea`'s, which `sameJob` uses. */
export type SpecMask = { source: string; id: string; width: number; height: number; bounds: Box | null };

export type JobSpec = Omit<JobInput, "start" | "refs" | "mask"> & {
  start: SpecStart | null;
  refs: SpecRef[];
  mask: SpecMask | null;
};

/** How the server turns a source (`comfy:`, `saved:`, `codex:`, `upload:`) into the picture's bytes. */
export type ResolveSource = (source: string) => Promise<Blob>;

/** The key `toSpec` looks a mask up by in `uploaded`. */
export const maskUploadKey = (maskId: string) => `mask:${maskId}`;

/**
 * Runs in the browser. `uploaded` maps a picture's key (or `maskUploadKey` for the mask) to the `upload:<id>` source
 * it was sent to the server as; every picture that only the browser has, and the mask, must be in it.
 */
export function toSpec(input: JobInput, uploaded: Record<string, string>): JobSpec {
  const { start, refs, mask, ...rest } = input;
  let maskSpec: SpecMask | null = null;
  if (mask) {
    const source = uploaded[maskUploadKey(mask.id)];
    if (!source) throw new Error("The painted area was not uploaded.");
    // The server keeps no strokes, so the painted area's box is worked out here.
    maskSpec = { source, id: mask.id, width: mask.width, height: mask.height, bounds: maskBounds(mask, mask.width, mask.height) };
  }
  return {
    ...rest,
    start: start && {
      key: start.key,
      source: start.source,
      ...(start.image && { image: start.image }),
      ...(start.slot && { slot: start.slot }),
      ...(uploaded[start.key] && { fetch: uploaded[start.key] }),
    },
    refs: (refs ?? []).map((r) => ({
      key: r.key,
      source: r.source,
      label: r.label,
      role: r.role,
      weight: r.weight,
      ...(uploaded[r.key] && { fetch: uploaded[r.key] }),
    })),
    mask: maskSpec,
  };
}

/** Runs on the server: the job again, with each picture fetched through `resolve` when it is needed. */
export function fromSpec(spec: JobSpec, resolve: ResolveSource): JobInput {
  const { start, refs, mask, edit, family, ...rest } = spec;
  return {
    ...rest,
    // The edit model and the drawing family carry the functions that build their workflows, which JSON drops: they are looked up again by id.
    edit: edit && { ...edit, check: { ...edit.check, model: editModel(edit.check.model.id) ?? edit.check.model } },
    family: family && { ...family, model: drawModel(family.model.id) ?? family.model },
    start: start && {
      key: start.key,
      source: start.source,
      thumb: "",
      blob: () => resolve(start.fetch ?? start.source),
      ...(start.image && { image: start.image }),
      ...(start.slot && { slot: start.slot }),
    },
    refs: refs.map((r) => ({
      key: r.key,
      source: r.source,
      label: r.label,
      role: r.role,
      weight: r.weight,
      thumb: "",
      blob: () => resolve(r.fetch ?? r.source),
    })),
    // The strokes are not kept: the PNG is already drawn.
    mask: mask && ({ strokes: [], softness: 0, inverted: false, id: mask.id, width: mask.width, height: mask.height, bounds: mask.bounds ?? null, render: () => resolve(mask.source) } satisfies PaintedArea),
  };
}
