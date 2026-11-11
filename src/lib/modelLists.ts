import { z } from "zod";
import { db } from "./db";

// The model list a connection last returned ("Test connection" in the browser, or "Test from server"), kept on the
// server so Settings shows it again without asking the provider. Stored in the settings key/value table under
// "models:<connection id>"; removing the connection removes it.

export type ModelList = { ids: string[]; fetchedAt: number };

/** Featherless lists over 10,000 models. */
export const ModelIdsSchema = z.array(z.string().min(1).max(300)).max(50_000);

const key = (connectionId: string) => `models:${connectionId}`;

export function getModelList(connectionId: string): ModelList | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key(connectionId)) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as ModelList;
    return Array.isArray(parsed.ids) && typeof parsed.fetchedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function setModelList(connectionId: string, ids: string[]): ModelList {
  const list = { ids: [...new Set(ids)].sort(), fetchedAt: Date.now() };
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key(connectionId), JSON.stringify(list));
  return list;
}

export function deleteModelList(connectionId: string): void {
  db().prepare("DELETE FROM settings WHERE key = ?").run(key(connectionId));
}
