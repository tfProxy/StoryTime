import { z } from "zod";
import { db, newId } from "./db";
import { ENTRY_TYPES, foldCodex, type CodexEntry, type CodexOp } from "./codex";
import { getPath, PostError } from "./stories";

const text = (max: number) => z.string().trim().max(max);

export const CODEX_LIMITS = { name: 100, content: 8000, alias: 60, aliases: 10 };

const changeFields = {
  op: z.enum(["create", "replace", "retire"]),
  /** Required for replace and retire; ignored for create (the server assigns one). */
  entry_id: z.string().min(1).optional(),
  name: text(CODEX_LIMITS.name).default(""),
  type: z.enum(ENTRY_TYPES).default("note"),
  aliases: z.array(text(CODEX_LIMITS.alias).min(1)).max(CODEX_LIMITS.aliases).default([]),
  content: text(CODEX_LIMITS.content).default(""),
  always_include: z.boolean().default(false),
};

const checkChange = <T extends z.ZodType<{ op: string; entry_id?: string; name: string }>>(schema: T) =>
  schema
    .refine((v) => v.op === "create" || v.entry_id !== undefined, { message: "entry_id is required for replace and retire" })
    .refine((v) => v.op === "retire" || v.name.length > 0, { message: "name is required" });

export const NewCodexOpSchema = checkChange(
  z.object({ anchor_chapter_id: z.string().min(1), ...changeFields }),
);

/** Codex changes sent along with a chapter; they are anchored at that chapter when it is saved. */
export const CodexChangesSchema = z.object({
  codex_changes: z.array(checkChange(z.object(changeFields))).max(50).default([]),
});

/** Runs `save` (which posts or edits a chapter) and anchors the codex changes at that chapter, all or nothing. */
export function saveWithCodexChanges<R>(
  changes: z.infer<typeof CodexChangesSchema>["codex_changes"],
  save: () => R,
  anchorOf: (r: R) => string,
): R {
  return db().transaction(() => {
    const result = save();
    for (const c of changes) createCodexOp({ ...c, anchor_chapter_id: anchorOf(result) });
    return result;
  })();
}

type Row = {
  id: string;
  anchor_chapter_id: string;
  anchor_depth: number;
  entry_id: string;
  op: CodexOp["op"];
  name: string;
  type: CodexOp["type"];
  aliases: string;
  content: string;
  always_include: number;
  posted_at: number;
};

function toOp(r: Row): CodexOp {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(r.aliases);
    if (Array.isArray(parsed)) aliases = parsed.map(String);
  } catch {
    // leave empty
  }
  return { ...r, aliases, always_include: r.always_include === 1 };
}

/** Ops that apply at a chapter: those anchored on the path from the root to it, in effect order. */
export function getCodexOps(chapterId: string): CodexOp[] {
  const path = getPath(chapterId);
  if (path.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT o.id, o.anchor_chapter_id, c.depth AS anchor_depth, o.entry_id, o.op, o.name, o.type, o.aliases,
              o.content, o.always_include, o.posted_at
         FROM codex_ops o JOIN chapters c ON c.id = o.anchor_chapter_id
        WHERE o.removed_at IS NULL AND o.anchor_chapter_id IN (${path.map(() => "?").join(",")})
        ORDER BY c.depth, o.posted_at, o.rowid`,
    )
    .all(...path.map((c) => c.id)) as Row[];
  return rows.map(toOp);
}

export function getCodexState(chapterId: string): CodexEntry[] {
  return foldCodex(getCodexOps(chapterId));
}

export function createCodexOp(input: z.infer<typeof NewCodexOpSchema>): { id: string; entry_id: string } {
  return db().transaction(() => {
    const path = getPath(input.anchor_chapter_id);
    if (path.length === 0) throw new PostError("That chapter does not exist", 404);
    const anchor = path[path.length - 1];

    let entryId: string;
    if (input.op === "create") {
      entryId = newId();
    } else {
      entryId = input.entry_id!;
      if (input.op === "retire" && !foldCodex(getCodexOps(anchor.id)).some((e) => e.entry_id === entryId)) {
        throw new PostError("That entry doesn't exist at this point in the story", 409);
      }
    }

    const id = newId();
    db()
      .prepare(
        `INSERT INTO codex_ops (id, story_id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        anchor.story_id,
        anchor.id,
        entryId,
        input.op,
        input.name,
        input.type,
        JSON.stringify(input.aliases),
        input.content,
        input.always_include ? 1 : 0,
        Date.now(),
      );
    return { id, entry_id: entryId };
  })();
}

/** The codex in the shape the AI prompt builder takes. */
export function getContextCodex(chapterId: string | null) {
  if (!chapterId) return [];
  return getCodexState(chapterId).map((e) => ({
    id: e.entry_id,
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    content: e.content,
    always_include: e.always_include,
  }));
}
