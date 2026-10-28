// The prompt history: a short-lived log of the app's recent text AI calls (prompt, reply, where it came from), kept in
// SQLite so it survives a restart. Server only. Every function takes the database, so this file never imports db.ts
// (db.ts calls `ensureAiLog` and `installAiRecorder` when it opens the connection).
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { setChatRecorder, type ChatRecord } from "./ai/client";

/**
 * THIS TABLE IS NEVER MIGRATED and is not in MIGRATIONS (db.ts). Its name carries its version. When its shape has to
 * change, rename it (ai_calls_v2) and change the CREATE below: on start `ensureAiLog` drops every other `ai_calls_v*`
 * table and creates the current one. Losing a few days of history on an update is fine; do not write an ALTER.
 *
 * No foreign keys on purpose: rows outlive deleted stories and chapters and must never block a delete.
 */
export const AI_LOG_TABLE = "ai_calls_v1";

/** The longest a stored text field is; the rest is replaced by a marker saying how much was cut. */
export const AI_LOG_FIELD_LIMIT = 200_000;
export const AI_LOG_MAX_ROWS = 200;
export const AI_LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** The label of a call that was made without one. */
export const AI_LOG_OTHER = "Other";

export function ensureAiLog(d: Database.Database): void {
  const old = d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ai\\_calls\\_v%' ESCAPE '\\'`).all() as { name: string }[];
  for (const { name } of old) if (name !== AI_LOG_TABLE) d.exec(`DROP TABLE "${name}"`);
  d.exec(`
    CREATE TABLE IF NOT EXISTS ${AI_LOG_TABLE} (
      id           TEXT PRIMARY KEY,
      at           INTEGER NOT NULL,
      ms           INTEGER NOT NULL,
      side         TEXT NOT NULL,
      source       TEXT NOT NULL,
      story_id     TEXT,
      chapter_id   TEXT,
      run_id       TEXT,
      item_key     TEXT,
      connection   TEXT,
      model        TEXT,
      role         TEXT,
      temperature  REAL,
      thinking_off INTEGER NOT NULL DEFAULT 0,
      system       TEXT,
      messages     TEXT NOT NULL,
      reply        TEXT,
      status       TEXT NOT NULL,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS ${AI_LOG_TABLE}_at ON ${AI_LOG_TABLE} (at);
  `);
}

export type AiCallInput = {
  at: number;
  ms: number;
  side: "server" | "browser";
  source?: string | null;
  storyId?: string | null;
  chapterId?: string | null;
  runId?: string | null;
  itemKey?: string | null;
  connection?: string | null;
  model?: string | null;
  role?: "main" | "cheap" | null;
  temperature?: number | null;
  thinkingOff?: boolean;
  system?: string | null;
  messages: { role: string; content: string }[];
  reply?: string | null;
  status: "ok" | "failed" | "stopped";
  error?: string | null;
};

/** Cuts a text at the field limit, saying how much went. */
export function cutText(s: string, limit = AI_LOG_FIELD_LIMIT): string {
  return s.length <= limit ? s : `${s.slice(0, limit)}…[cut: ${s.length - limit} more characters]`;
}
const cutOrNull = (s: string | null | undefined) => (s == null ? null : cutText(s));

/** Stores one call, then trims the table (rows older than 3 days, then all but the newest 200). Returns the id. */
export function recordAiCall(d: Database.Database, row: AiCallInput): string {
  const id = crypto.randomUUID();
  d.prepare(
    `INSERT INTO ${AI_LOG_TABLE}
       (id, at, ms, side, source, story_id, chapter_id, run_id, item_key, connection, model, role, temperature,
        thinking_off, system, messages, reply, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    Math.round(row.at),
    Math.max(0, Math.round(row.ms)),
    row.side,
    row.source?.trim() || AI_LOG_OTHER,
    row.storyId ?? null,
    row.chapterId ?? null,
    row.runId ?? null,
    row.itemKey ?? null,
    row.connection ?? null,
    row.model ?? null,
    row.role ?? null,
    row.temperature ?? null,
    row.thinkingOff ? 1 : 0,
    cutOrNull(row.system),
    JSON.stringify(row.messages.map((m) => ({ role: m.role, content: cutText(m.content) }))),
    cutOrNull(row.reply),
    row.status,
    cutOrNull(row.error),
  );
  d.prepare(`DELETE FROM ${AI_LOG_TABLE} WHERE at < ?`).run(Date.now() - AI_LOG_MAX_AGE_MS);
  d.prepare(
    `DELETE FROM ${AI_LOG_TABLE} WHERE rowid NOT IN (SELECT rowid FROM ${AI_LOG_TABLE} ORDER BY at DESC, rowid DESC LIMIT ?)`,
  ).run(AI_LOG_MAX_ROWS);
  return id;
}

export type AiCallSummary = {
  id: string;
  at: number;
  ms: number;
  side: string;
  source: string;
  story_id: string | null;
  story_title: string | null;
  chapter_id: string | null;
  run_id: string | null;
  item_key: string | null;
  connection: string | null;
  model: string | null;
  role: string | null;
  status: string;
  error: string | null;
};

export type AiCallFilter = { source?: string; storyId?: string; chapterId?: string; runId?: string; failedOnly?: boolean; limit?: number };

/** The newest calls first, without the prompt and reply texts. */
export function listAiCalls(d: Database.Database, f: AiCallFilter = {}): AiCallSummary[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.source) { where.push("a.source = ?"); args.push(f.source); }
  if (f.storyId) { where.push("a.story_id = ?"); args.push(f.storyId); }
  if (f.chapterId) { where.push("a.chapter_id = ?"); args.push(f.chapterId); }
  if (f.runId) { where.push("a.run_id = ?"); args.push(f.runId); }
  if (f.failedOnly) where.push("a.status = 'failed'");
  const limit = Math.min(Math.max(Math.floor(f.limit ?? AI_LOG_MAX_ROWS), 1), AI_LOG_MAX_ROWS);
  return d
    .prepare(
      `SELECT a.id, a.at, a.ms, a.side, a.source, a.story_id, s.title AS story_title, a.chapter_id, a.run_id, a.item_key,
              a.connection, a.model, a.role, a.status, a.error
       FROM ${AI_LOG_TABLE} a LEFT JOIN stories s ON s.id = a.story_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
    )
    .all(...args, limit) as AiCallSummary[];
}

/** The labels present in the log, for the page's filter. */
export function listAiSources(d: Database.Database): string[] {
  return (d.prepare(`SELECT DISTINCT source FROM ${AI_LOG_TABLE} ORDER BY source`).all() as { source: string }[]).map((r) => r.source);
}

export type AiCallFull = AiCallSummary & {
  temperature: number | null;
  thinking_off: boolean;
  system: string | null;
  messages: { role: string; content: string }[];
  reply: string | null;
};

export function getAiCall(d: Database.Database, id: string): AiCallFull | null {
  const row = d
    .prepare(
      `SELECT a.*, s.title AS story_title FROM ${AI_LOG_TABLE} a LEFT JOIN stories s ON s.id = a.story_id WHERE a.id = ?`,
    )
    .get(id) as (Omit<AiCallFull, "messages" | "thinking_off"> & { messages: string; thinking_off: number }) | undefined;
  if (!row) return null;
  let messages: AiCallFull["messages"] = [];
  try {
    messages = JSON.parse(row.messages);
  } catch {
    // stored by us as JSON; an unreadable value just shows as no messages
  }
  return { ...row, messages, thinking_off: !!row.thinking_off };
}

/**
 * Makes the chat client report every call into this database. Called by db.ts when it opens the connection, so the
 * recorder exists wherever the database is used (the worker, route handlers and AI runs all open it).
 */
export function installAiRecorder(d: Database.Database): void {
  setChatRecorder((r: ChatRecord) => {
    recordAiCall(d, {
      at: r.at,
      ms: r.ms,
      side: "server",
      source: r.source?.label,
      storyId: r.source?.storyId,
      chapterId: r.source?.chapterId,
      runId: r.source?.runId,
      itemKey: r.source?.itemKey,
      connection: r.connection,
      model: r.model,
      role: r.role,
      temperature: r.temperature,
      thinkingOff: r.thinkingOff,
      system: r.system,
      messages: r.messages,
      reply: r.reply,
      status: r.status,
      error: r.error,
    });
  });
}
