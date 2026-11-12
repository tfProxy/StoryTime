import { db } from "./db";
import { chapterImageVersions } from "./chapterImages";
import { chapterImageUrl, IMAGE_SLOTS } from "./imageSlots";
import { checkImage, PostError } from "./stories";
import type { IconChoice } from "./codexIconUrl";

// A codex entry's icon (see migration 53): one picture per entry of a story, shown round in the codex list and on the
// entry. It is picked from the story's pictures or uploaded, is the same on every chapter and branch, and is never sent
// to ComfyUI or the AI. An entry linked to a shared entry has the story's own icon; the shared entry has none. The
// browser loads one from `codexIconUrl` (./codexIconUrl).

function requireEntry(storyId: string, entryId: string) {
  if (!db().prepare(`SELECT 1 FROM codex_ops WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId)) {
    throw new PostError("That codex entry does not exist", 404);
  }
}

/** Each entry's icon version (when it was last set), by entry id; entries without an icon are left out. */
export function codexIcons(storyId: string): Record<string, number> {
  const rows = db().prepare(`SELECT entry_id, updated_at FROM codex_icons WHERE story_id = ?`).all(storyId) as { entry_id: string; updated_at: number }[];
  return Object.fromEntries(rows.map((r) => [r.entry_id, r.updated_at]));
}

/** One entry's icon version, or null when it has none. */
export function codexIconVersion(storyId: string, entryId: string): number | null {
  const row = db().prepare(`SELECT updated_at FROM codex_icons WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId) as { updated_at: number } | undefined;
  return row?.updated_at ?? null;
}

/** The icon's bytes, or undefined when the entry has none. */
export function getCodexIcon(storyId: string, entryId: string): { type: string; bytes: Buffer; version: number } | undefined {
  const row = db().prepare(`SELECT image, type, updated_at FROM codex_icons WHERE story_id = ? AND entry_id = ?`).get(storyId, entryId) as
    | { image: Buffer; type: string; updated_at: number }
    | undefined;
  return row && { type: row.type, bytes: row.image, version: row.updated_at };
}

/** Sets (or replaces) the entry's icon. */
export function setCodexIcon(storyId: string, entryId: string, bytes: Buffer): { version: number } {
  const type = checkImage(bytes, "icon");
  if (!db().prepare(`SELECT 1 FROM stories WHERE id = ?`).get(storyId)) throw new PostError("That story does not exist", 404);
  requireEntry(storyId, entryId);
  // Two saves in the same millisecond must still get different versions.
  const version = Math.max(Date.now(), (codexIconVersion(storyId, entryId) ?? 0) + 1);
  db()
    .prepare(
      `INSERT INTO codex_icons (story_id, entry_id, image, type, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (story_id, entry_id) DO UPDATE SET image = excluded.image, type = excluded.type, updated_at = excluded.updated_at`,
    )
    .run(storyId, entryId, bytes, type, version);
  return { version };
}

/** How many saved pictures the icon picker offers. */
const ICON_CHOICES = 60;

const SLOT_WORDS = { header: "header", middle: "middle", footer: "footer" } as const;

/**
 * The story's saved pictures an icon can be picked from: the headers, middles and footers of the chapters on the path
 * (the latest chapter first), the cover, then the other chapters' (in `chapters` order).
 */
export function iconChoices(storyId: string, chapters: { id: string; title: string }[], pathIds: string[], coverVersion: number | null): IconChoice[] {
  const onPath = new Set(pathIds);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const order = [...[...pathIds].reverse().flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), ...chapters.filter((c) => !onPath.has(c.id))];
  const versions = chapterImageVersions(order.map((c) => c.id));
  const out: IconChoice[] = [];
  const add = (c: { id: string; title: string }) => {
    for (const slot of IMAGE_SLOTS) {
      const v = versions.get(c.id)?.[slot] ?? null;
      if (v !== null) out.push({ key: `saved:${c.id}:${slot}`, label: `${c.title.length > 24 ? `${c.title.slice(0, 23).trimEnd()}…` : c.title} ${SLOT_WORDS[slot]}`, url: chapterImageUrl(c.id, slot, v) });
    }
  };
  const path = order.filter((c) => onPath.has(c.id));
  path.forEach(add);
  if (coverVersion !== null) out.push({ key: `saved:${storyId}:cover`, label: "Cover", url: `/api/stories/${storyId}/cover?v=${coverVersion}` });
  order.filter((c) => !onPath.has(c.id)).forEach(add);
  return out.slice(0, ICON_CHOICES);
}

/** Takes the entry's icon away. */
export function removeCodexIcon(storyId: string, entryId: string): { ok: true } {
  const done = db().prepare(`DELETE FROM codex_icons WHERE story_id = ? AND entry_id = ?`).run(storyId, entryId);
  if (done.changes === 0) throw new PostError("That entry has no icon", 404);
  return { ok: true };
}
