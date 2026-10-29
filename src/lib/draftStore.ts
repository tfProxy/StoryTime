import { db } from "./db";

// Server-side storage for drafts. A draft is opaque JSON to the server, apart from the few
// fields the drafts list shows. Each save says which version it started from (`base`), so a
// save from a second tab or device can't silently overwrite newer work.

/** Biggest draft accepted, in characters of JSON (twenty full-length versions plus undo fit easily). */
export const MAX_DRAFT_CHARS = 8_000_000;

export type DraftListItem = {
  key: string;
  href: string;
  label: string;
  title: string;
  storyTitle: string;
  updatedAt: number;
};

type Row = { key: string; data: string; updated_at: number };

const str = (v: unknown) => (typeof v === "string" ? v : "");

function parse(row: Row): Record<string, unknown> {
  return { ...(JSON.parse(row.data) as Record<string, unknown>), key: row.key, updatedAt: row.updated_at };
}

export function listDrafts(): DraftListItem[] {
  const rows = db().prepare("SELECT key, data, updated_at FROM drafts ORDER BY updated_at DESC").all() as Row[];
  return rows.map((r) => {
    const d = parse(r);
    return { key: r.key, href: str(d.href), label: str(d.label), title: str(d.title), storyTitle: str(d.storyTitle), updatedAt: r.updated_at };
  });
}

export function getDraft(key: string): Record<string, unknown> | null {
  const row = db().prepare("SELECT key, data, updated_at FROM drafts WHERE key = ?").get(key) as Row | undefined;
  return row ? parse(row) : null;
}

export type PutResult = { ok: true; updatedAt: number } | { ok: false; current: Record<string, unknown> };

/**
 * Saves a draft. `base` is the `updatedAt` of the version the browser started from, or null if it
 * started from nothing; if the stored draft has moved on since, nothing is written and the stored
 * one is returned. With `importedAt` (a draft moved over from browser storage) there is no base:
 * the draft is written only if it is newer than what is stored.
 */
export function putDraft(
  key: string,
  draft: Record<string, unknown>,
  opts: { base: number | null } | { importedAt: number },
): PutResult {
  const d = db();
  return d.transaction((): PutResult => {
    const row = d.prepare("SELECT key, data, updated_at FROM drafts WHERE key = ?").get(key) as Row | undefined;
    if ("importedAt" in opts) {
      if (row && row.updated_at >= opts.importedAt) return { ok: false, current: parse(row) };
    } else if ((row?.updated_at ?? null) !== opts.base) {
      return row ? { ok: false, current: parse(row) } : { ok: false, current: {} };
    }
    // Always moves forward, so two saves in the same millisecond still differ.
    const updatedAt = "importedAt" in opts ? opts.importedAt : Math.max(Date.now(), (row?.updated_at ?? 0) + 1);
    const data = { ...draft };
    delete data.key;
    delete data.updatedAt;
    d.prepare(
      "INSERT INTO drafts (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    ).run(key, JSON.stringify(data), updatedAt);
    return { ok: true, updatedAt };
  })();
}

/**
 * Moves a draft to another key, with a new place to resume it and a new label (used when a story started
 * as a draft on the old New story page becomes a story whose first chapter is still to be written).
 * Does nothing when there is no draft at `from`, or one at `to` already.
 */
export function moveDraft(from: string, to: string, patch: { href: string; label: string }): boolean {
  const d = db();
  return d.transaction(() => {
    const row = d.prepare("SELECT key, data, updated_at FROM drafts WHERE key = ?").get(from) as Row | undefined;
    if (!row || d.prepare("SELECT 1 FROM drafts WHERE key = ?").get(to)) return false;
    const data = { ...(JSON.parse(row.data) as Record<string, unknown>), ...patch };
    d.prepare("INSERT INTO drafts (key, data, updated_at) VALUES (?, ?, ?)").run(to, JSON.stringify(data), Math.max(Date.now(), row.updated_at + 1));
    d.prepare("DELETE FROM drafts WHERE key = ?").run(from);
    return true;
  })();
}

/** Which of these keys have a draft saved. */
export function draftKeysSaved(keys: string[]): Set<string> {
  if (keys.length === 0) return new Set();
  const rows = db()
    .prepare(`SELECT key FROM drafts WHERE key IN (${keys.map(() => "?").join(", ")})`)
    .all(...keys) as { key: string }[];
  return new Set(rows.map((r) => r.key));
}

export function deleteDraft(key: string): boolean {
  return db().prepare("DELETE FROM drafts WHERE key = ?").run(key).changes > 0;
}
