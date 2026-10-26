// Pictures the browser sends for a job (a picked file, Refine's flattened picture, a painted mask) are kept in
// `work_uploads` until the job has been made. Nothing reads them back yet; `resolveSource` comes with the upload route.
import { db } from "../db";

/** Uploads are kept this long, then deleted. */
export const KEEP_UPLOADS_MS = 24 * 60 * 60 * 1000;

/** Deletes uploads older than a day; says how many. */
export function deleteOldUploads(now = Date.now()): number {
  return db().prepare(`DELETE FROM work_uploads WHERE created_at < ?`).run(now - KEEP_UPLOADS_MS).changes;
}
