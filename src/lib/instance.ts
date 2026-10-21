import { db, newId } from "./db";

// This StoryTime's own id, made once and kept in the settings table (not in the settings JSON, so it isn't
// exported or overwritten when settings are saved). Jobs it queues in ComfyUI carry it, so a ComfyUI shared by
// several StoryTimes (and other tools) can tell whose jobs are whose.
const KEY = "instance_id";

export function instanceId(): string {
  const d = db();
  const row = d.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (row) return row.value;
  const id = newId();
  // Two first requests at once keep the first id.
  d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(KEY, id);
  return (d.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string }).value;
}
