import { db } from "./db";
import { parseSettings, type Settings } from "./settingsSchema";

const KEY = "settings";

/** null until settings have been saved for the first time. */
export function getSettings(): Settings | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? parseSettings(JSON.parse(row.value)) : null;
}

export function putSettings(input: unknown): Settings {
  const settings = parseSettings(input);
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, JSON.stringify(settings));
  return settings;
}
