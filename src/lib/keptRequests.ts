// Kept AI requests: every call that wrote chapter text (a Generate, an AI run's chapter), kept for good with
// what is needed to make it again: the connection (never its key), model, settings, the exact prompt, the reply and how
// long it took. Drafts (`ai` on the text and on each version and undo step) and chapter_writing point to them by id.
// Server only. Every function takes the database, so this file never imports db.ts (aiLog.ts calls keepRequest from
// the recorder that db.ts installs).
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ChatRecord } from "./ai/client";

export type KeptRequest = {
  id: string;
  at: number;
  /** How long the whole call took, and how long until the first text came. */
  ms: number;
  firstTextMs: number | null;
  side: "server" | "browser";
  source: string | null;
  storyId: string | null;
  chapterId: string | null;
  runId: string | null;
  connectionId: string | null;
  /** The connection's name when the call was made. */
  connection: string | null;
  kind: string | null;
  baseUrl: string | null;
  model: string | null;
  role: "main" | "cheap" | null;
  job: string | null;
  temperature: number | null;
  thinkingOff: boolean;
  maxTokens: number | null;
  system: string | null;
  messages: { role: string; content: string }[];
  reply: string;
  status: "ok" | "failed" | "stopped";
  error: string | null;
};

/** Unreferenced kept requests (a Generate thrown away, a draft deleted) go after this long. */
export const KEPT_UNREFERENCED_DAYS = 30;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

const nullableText = (max: number) => z.string().max(max).nullish().transform((v) => v ?? null);

/** What a browser sends for a call it kept (the `keep` part of its record, see /api/ai-log). */
export const KeptDetailsSchema = z.object({
  id: z.string().uuid(),
  connectionId: nullableText(200),
  kind: nullableText(40),
  baseUrl: nullableText(500),
  job: nullableText(40),
  maxTokens: z.number().int().min(0).nullish().transform((v) => v ?? null),
  firstTextMs: z.number().finite().min(0).nullish().transform((v) => v ?? null),
});

/** Stores a kept call. A record without `keep` is ignored; the same id twice keeps the first. */
export function keepRequest(d: Database.Database, record: ChatRecord, side: "server" | "browser"): void {
  const k = record.keep;
  if (!k) return;
  const row: KeptRequest = {
    id: k.id,
    at: Math.round(record.at),
    ms: Math.max(0, Math.round(record.ms)),
    firstTextMs: k.firstTextMs === null ? null : Math.round(k.firstTextMs),
    side,
    source: record.source?.label ?? null,
    storyId: record.source?.storyId ?? null,
    chapterId: record.source?.chapterId ?? null,
    runId: record.source?.runId ?? null,
    connectionId: k.connectionId,
    connection: record.connection,
    kind: k.kind,
    baseUrl: k.baseUrl,
    model: record.model,
    role: record.role,
    job: k.job,
    temperature: record.temperature,
    thinkingOff: record.thinkingOff,
    maxTokens: k.maxTokens,
    system: record.system ?? null,
    messages: record.messages.map((m) => ({ role: m.role, content: m.content })),
    reply: record.reply,
    status: record.status,
    error: record.error ?? null,
  };
  d.prepare(`INSERT OR IGNORE INTO ai_requests (id, at, data) VALUES (?, ?, ?)`).run(row.id, row.at, JSON.stringify(row));
  pruneKeptRequests(d);
}

/** The kept requests with these ids, in the order given; ids not found are left out. */
export function getKeptRequests(d: Database.Database, ids: readonly string[]): KeptRequest[] {
  if (!ids.length) return [];
  const rows = d.prepare(`SELECT id, data FROM ai_requests WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids) as { id: string; data: string }[];
  const byId = new Map<string, KeptRequest>();
  for (const r of rows) {
    try {
      byId.set(r.id, JSON.parse(r.data) as KeptRequest);
    } catch {
      // stored by us as JSON; an unreadable one is left out
    }
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Removes kept requests older than KEPT_UNREFERENCED_DAYS that no draft or kept chapter writing mentions. Runs at
 * most every few hours (`force` for tests). Ids are random UUIDs, so finding one in the JSON text is a safe test.
 */
export function pruneKeptRequests(d: Database.Database, force = false): number {
  const holder = globalThis as unknown as { __storytimeKeptPrunedAt?: number };
  if (!force && Date.now() - (holder.__storytimeKeptPrunedAt ?? 0) < PRUNE_EVERY_MS) return 0;
  holder.__storytimeKeptPrunedAt = Date.now();
  const cutoff = Date.now() - KEPT_UNREFERENCED_DAYS * 24 * 60 * 60 * 1000;
  return d
    .prepare(
      `DELETE FROM ai_requests WHERE at < ?
         AND NOT EXISTS (SELECT 1 FROM drafts WHERE instr(drafts.data, ai_requests.id) > 0)
         AND NOT EXISTS (SELECT 1 FROM chapter_writing WHERE instr(chapter_writing.data, ai_requests.id) > 0)`,
    )
    .run(cutoff).changes;
}

/** Kept request ids as stored in drafts and chapter writing. */
export const KeptIdsSchema = z.array(z.string().uuid()).max(50);
