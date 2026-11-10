import { z } from "zod";
import { db } from "./db";
import { LIMITS } from "./limits";
import { MAX_VERSIONS } from "./generatedDraft";
import { PostError } from "./stories";
import { KeptIdsSchema } from "./keptRequests";

// How a chapter was written, kept from its draft when it is posted (or an edit is saved), so the edit page starts
// with the same direction prompt, generated versions, length and models instead of an empty form.

// `ai`: the kept AI requests (keptRequests.ts) that wrote a version, and, at the top, the chapter's text as posted.
const VersionSchema = z.object({ title: z.string().max(LIMITS.title), body: z.string().max(LIMITS.body), ai: KeptIdsSchema.optional() });
const ModelRefSchema = z.object({ connectionId: z.string().max(200), model: z.string().max(500) });

export const ChapterWritingSchema = z.object({
  prompt: z.string().max(LIMITS.body),
  versions: z.array(VersionSchema).max(MAX_VERSIONS),
  ai: KeptIdsSchema.optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  models: z.object({ write: ModelRefSchema.optional(), suggest: ModelRefSchema.optional() }).optional(),
  codexOverrides: z.object({ include: z.array(z.string().max(100)).max(500), exclude: z.array(z.string().max(100)).max(500) }).optional(),
});

export type ChapterWriting = z.infer<typeof ChapterWritingSchema>;

export function getChapterWriting(chapterId: string): ChapterWriting | null {
  const row = db().prepare(`SELECT data FROM chapter_writing WHERE chapter_id = ?`).get(chapterId) as { data: string } | undefined;
  if (!row) return null;
  const parsed = ChapterWritingSchema.safeParse(JSON.parse(row.data));
  return parsed.success ? parsed.data : null;
}

export function setChapterWriting(chapterId: string, input: ChapterWriting): { ok: true } {
  if (!db().prepare(`SELECT 1 FROM chapters WHERE id = ?`).get(chapterId)) throw new PostError("That chapter does not exist", 404);
  db()
    .prepare(
      `INSERT INTO chapter_writing (chapter_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(chapterId, JSON.stringify(input), Date.now());
  return { ok: true };
}

/**
 * The versions an edit starts with: the kept ones, showing the one that matches the chapter as posted. When the
 * chapter was changed by hand after the last Generate (or edited since), its text is added as the newest version.
 */
export function versionsForEdit(kept: ChapterWriting["versions"], title: string, body: string): { versions: ChapterWriting["versions"]; versionIndex: number } {
  const at = kept.findIndex((v) => v.title === title && v.body === body);
  if (at >= 0) return { versions: kept, versionIndex: at };
  const versions = [...kept, { title, body }].slice(-MAX_VERSIONS);
  return { versions, versionIndex: versions.length - 1 };
}
