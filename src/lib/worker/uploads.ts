// Pictures the browser sends for a job (a picked file, Refine's flattened picture, a painted mask) are kept in
// `work_uploads` until the job has been made, and `resolveSource` turns any picture source a job names into its bytes.
import { db, newId } from "../db";
import { fetchImage } from "../comfy/client";
import { imageSize } from "../imageSize";
import { IMAGE_SLOTS } from "../imageSlots";
import { getSettings } from "../settingsStore";
import { selfFetch } from "./selfFetch";

/** Uploads are kept this long, then deleted. */
export const KEEP_UPLOADS_MS = 24 * 60 * 60 * 1000;

/** The biggest upload accepted. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The image type of a PNG, JPEG or WebP file read from its bytes, or null for anything else (or a cut-off file). */
export function uploadType(bytes: Uint8Array): string | null {
  if (!imageSize(bytes)) return null;
  if (bytes[0] === 0x89) return "image/png";
  if (bytes[0] === 0xff) return "image/jpeg";
  return "image/webp";
}

/** Keeps a picture the browser sent; answers its source, `upload:<id>`. */
export function saveUpload(bytes: Uint8Array, now = Date.now()): string {
  if (bytes.length === 0) throw new UploadError("No image was sent", 400);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("That image is too large (20 MB at most)", 413);
  const type = uploadType(bytes);
  if (!type) throw new UploadError("The picture must be a PNG, JPEG or WebP image", 415);
  const id = newId();
  db().prepare(`INSERT INTO work_uploads (id, type, bytes, created_at) VALUES (?, ?, ?, ?)`).run(id, type, Buffer.from(bytes), now);
  return `upload:${id}`;
}

export function getUpload(id: string): { type: string; bytes: Buffer } | null {
  const row = db().prepare(`SELECT type, bytes FROM work_uploads WHERE id = ?`).get(id) as { type: string; bytes: Buffer } | undefined;
  return row ?? null;
}

/** Deletes uploads older than a day; says how many. */
export function deleteOldUploads(now = Date.now()): number {
  return db().prepare(`DELETE FROM work_uploads WHERE created_at < ?`).run(now - KEEP_UPLOADS_MS).changes;
}

async function viaSelf(path: string, what: string): Promise<Blob> {
  const res = await selfFetch(path);
  if (!res.ok) throw new Error(`Couldn't read ${what} (${res.status}).`);
  return res.blob();
}

/**
 * The picture a source names, as the browser's `StartPicture` and `Reference` sources spell them:
 *   upload:<id>                 a picture the browser sent (see `saveUpload`)
 *   comfy:<subfolder/file>      one of ComfyUI's own pictures, in its output folder
 *   saved:<owner>:<slot>        a chapter's header or footer (owner is the chapter), or the story's cover (owner is the story)
 *   codex:<picture id>          a codex entry's saved picture
 */
export async function resolveSource(source: string): Promise<Blob> {
  const colon = source.indexOf(":");
  const kind = colon < 0 ? "" : source.slice(0, colon);
  const rest = colon < 0 ? "" : source.slice(colon + 1);

  if (kind === "upload") {
    const upload = getUpload(rest);
    if (!upload) throw new Error("A picture sent for this job is no longer kept. Ask for the job again.");
    return new Blob([new Uint8Array(upload.bytes)], { type: upload.type });
  }

  if (kind === "comfy") {
    const url = getSettings()?.comfy.url.trim();
    if (!url) throw new Error("No ComfyUI address is set. Add it in Settings.");
    const slash = rest.lastIndexOf("/");
    return fetchImage(url, { filename: rest.slice(slash + 1), subfolder: slash < 0 ? "" : rest.slice(0, slash), type: "output" });
  }

  if (kind === "saved") {
    const at = rest.lastIndexOf(":");
    const owner = rest.slice(0, at);
    const slot = rest.slice(at + 1);
    if (at < 1) throw new Error(`Not a picture source: ${source}`);
    if (slot === "cover") return viaSelf(`/api/stories/${encodeURIComponent(owner)}/cover`, "the saved cover");
    if ((IMAGE_SLOTS as readonly string[]).includes(slot)) {
      return viaSelf(`/api/chapters/${encodeURIComponent(owner)}/images/${slot}`, `the saved ${slot} picture`);
    }
    throw new Error(`Not a picture source: ${source}`);
  }

  if (kind === "codex") {
    // The source names only the picture, and the route wants its story as well.
    const row = db().prepare(`SELECT story_id FROM codex_pictures WHERE id = ? AND removed_at IS NULL`).get(rest) as { story_id: string } | undefined;
    if (!row) throw new Error("Couldn't read the saved codex picture (404).");
    return viaSelf(`/api/stories/${encodeURIComponent(row.story_id)}/codex-pictures/${encodeURIComponent(rest)}`, "the saved codex picture");
  }

  throw new Error(`Not a picture source: ${source}`);
}
