import { db } from "./db";
import { MAX_PRESETS } from "./comfy/presets";
import { drawPresetIdFor, parseSettings, upgradeComfy, type Settings } from "./settingsSchema";

const KEY = "settings";

/** Whether these are settings from before picture presets. */
const beforePresets = (raw: unknown) => {
  const comfy = raw && typeof raw === "object" ? (raw as { comfy?: unknown }).comfy : undefined;
  return !comfy || typeof comfy !== "object" || !Array.isArray((comfy as { drawPresets?: unknown }).drawPresets);
};

/**
 * Settings from before picture presets, upgraded: each checkpoint the stories used becomes a drawing
 * preset (see `upgradeComfy`), and each story is pointed at the one with its checkpoint. Stories with the
 * most used one, or none, are left to follow the first preset.
 */
function upgrade(raw: unknown): unknown {
  const rows = db()
    .prepare(`SELECT checkpoint FROM stories WHERE checkpoint != '' GROUP BY checkpoint ORDER BY COUNT(*) DESC, checkpoint LIMIT ?`)
    .all(MAX_PRESETS) as { checkpoint: string }[];
  const checkpoints = rows.map((r) => r.checkpoint);
  const point = db().prepare(`UPDATE stories SET draw_preset = ? WHERE checkpoint = ? AND draw_preset IS NULL`);
  checkpoints.forEach((c, i) => i > 0 && point.run(drawPresetIdFor(i), c));
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ...obj, comfy: upgradeComfy(obj.comfy ?? {}, checkpoints) };
}

const stored = (): unknown => {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
};

/**
 * Settings sent without presets: upgraded when the stored ones have none either, else (a page still running
 * the code from before presets) with the stored presets kept, so saving from it doesn't lose them.
 */
function withPresets(input: unknown): unknown {
  const kept = stored() as { comfy: Record<string, unknown> } | null;
  if (!kept || beforePresets(kept)) return upgrade(input);
  const obj = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const comfy = obj.comfy && typeof obj.comfy === "object" && !Array.isArray(obj.comfy) ? obj.comfy : {};
  const { drawPresets, editPresets, editPreset } = kept.comfy;
  return { ...obj, comfy: { ...comfy, drawPresets, editPresets, editPreset } };
}

/** null until settings have been saved for the first time. */
export function getSettings(): Settings | null {
  const raw = stored();
  if (raw === null) return null;
  return beforePresets(raw) ? putSettings(raw) : parseSettings(raw);
}

export function putSettings(input: unknown): Settings {
  return db().transaction(() => {
    const settings = parseSettings(beforePresets(input) ? withPresets(input) : input);
    db()
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(KEY, JSON.stringify(settings));
    return settings;
  })();
}
