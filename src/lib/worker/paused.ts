// Whether the queue is paused (D10): stored on the server, so it is the same on every device. A paused queue starts
// nothing new; what is already being made carries on.
import { db } from "../db";

const KEY = "queue_paused";

export function getPaused(): boolean {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  return row?.value === "1";
}

export function setPaused(paused: boolean): boolean {
  if (paused) db().prepare(`INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).run(KEY);
  else db().prepare(`DELETE FROM settings WHERE key = ?`).run(KEY);
  return paused;
}
