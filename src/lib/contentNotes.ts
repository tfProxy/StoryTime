import { db } from "./db";
import { getSettings } from "./settingsStore";
import { parseSettings } from "./settingsSchema";
import { getStoryChapters } from "./tree";
import { rollUpNotes, type ChapterNote, type NoteTag } from "./contentNotesRoll";

/**
 * What lies ahead of each chapter, for the notes under a choice: its own approved tags (`next`) and those further
 * down its branch (`later`). Only tags that are on for the story and marked Show to readers count. Empty when the
 * "Show content notes to readers" setting is off.
 */
export function contentNotes(storyId: string): Map<string, ChapterNote> {
  if (!(getSettings() ?? parseSettings({})).contentNotes) return new Map();
  const rows = db()
    .prepare(
      `SELECT ct.chapter_id, t.name, ct.value
         FROM chapter_tags ct
         JOIN chapters c ON c.id = ct.chapter_id
         JOIN tags t ON t.id = ct.tag_id AND t.removed_at IS NULL AND t.show_readers = 1
        WHERE c.story_id = ? AND ct.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM story_tags st WHERE st.story_id = c.story_id AND st.tag_id = ct.tag_id AND st.enabled = 0)`,
    )
    .all(storyId) as { chapter_id: string; name: string; value: string | null }[];
  const own = new Map<string, NoteTag[]>();
  for (const r of rows) own.set(r.chapter_id, [...(own.get(r.chapter_id) ?? []), { name: r.name, value: r.value }]);
  return rollUpNotes(getStoryChapters(storyId), own);
}
