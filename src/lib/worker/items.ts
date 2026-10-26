// The work queue's items in SQLite (`work_items`, migration 32): pictures to make, AI runs and Generates. A row's
// columns are what the scheduler reads; `data` is JSON per type, checked here on every write. The browser shows an
// item as `WorkItem` (WorkQueue.tsx); later tasks build that from a row. Every change is published on the queue's
// channel, as `{type: "item", item: row}` or `{type: "removed", key}`, for the events route.
import { z } from "zod";
import { db } from "../db";
import { publish, QUEUE_CHANNEL } from "./bus";
import { targetKey, type PictureTarget } from "../pictureTarget";

export const ITEM_TYPES = ["picture", "run", "generate"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_STATES = ["gathering", "waiting", "working", "paused", "done", "failed"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** Finished and failed items are kept this long, then left out of the list. */
export const KEEP_ENDED_MS = 7 * 24 * 60 * 60 * 1000;

const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chapter"), storyId: z.string(), chapterId: z.string() }),
  z.object({ kind: z.literal("cover"), storyId: z.string() }),
  z.object({ kind: z.literal("codex"), storyId: z.string(), entryId: z.string() }),
]);

// What the server only stores and hands on (the job spec, how the place looks, progress, the pictures made) is kept
// as loose JSON here and checked where it is used.
const json = z.record(z.string(), z.unknown());

/** A picture job: gathered from quick clicks, sent to ComfyUI, waited for, recorded. */
export const pictureData = z.object({
  target,
  /** The `JobSpec` (comfy/jobSpec.ts). */
  spec: json,
  count: z.number().int().min(1),
  /** How the job's place in the Pictures panel looks while it is made. */
  view: json,
  progress: z.unknown().optional(),
  /** ComfyUI's id for the job, saved as soon as it is known, so a restart can wait for it again. */
  promptId: z.string().optional(),
  clientId: z.string().optional(),
  /** A finished job's pictures. */
  pictures: z.array(z.unknown()).optional(),
  /** Why it failed, or a warning about a finished job. */
  message: z.string().optional(),
  /** Recorded as not seen yet. */
  unseen: z.boolean().optional(),
  /** A Refine screen's session (its id) and the base picture the job starts from. */
  session: z.string().optional(),
  base: z.string().optional(),
  /** Asked again once after it failed, for a picture run. */
  retried: z.boolean().optional(),
  /** The AI run that asked for it, if one did. */
  runId: z.string().optional(),
});
export type PictureData = z.infer<typeof pictureData>;

/** An AI run as the queue shows it (the run itself, and its task list, are in `ai_runs`). */
export const runData = z.object({
  runId: z.string(),
  storyId: z.string(),
  storyTitle: z.string(),
  startChapterId: z.string().nullable(),
  startTitle: z.string(),
  mode: z.enum(["fill", "tree", "arc", "pictures"]),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  current: z.string().optional(),
  error: z.string().optional(),
  /** Why it is paused when that isn't the author's doing ("Plan ready to check"). */
  note: z.string().optional(),
});
export type RunData = z.infer<typeof runData>;

/** A Generate from the writing page. The text is kept in the draft, not here. */
export const generateData = z.object({
  draftKey: z.string(),
  href: z.string(),
  label: z.string(),
  /** The `GenerateRequest`, kept so the work can start when its turn comes. */
  request: json,
  /** Why it waits ("Waiting for pictures to finish (2 left)"). */
  note: z.string().optional(),
  error: z.string().optional(),
  /** Kept with an error that lost the text, so it can be copied. */
  text: z.string().optional(),
});
export type GenerateData = z.infer<typeof generateData>;

const DATA = { picture: pictureData, run: runData, generate: generateData } as const;
type DataOf = { picture: PictureData; run: RunData; generate: GenerateData };

export type WorkRow<T extends ItemType = ItemType> = {
  [K in T]: {
    key: string;
    type: K;
    state: ItemState;
    /** Pictures only: `targetKey(target)`, to find a target's items. */
    targetKey: string | null;
    data: DataOf[K];
    /** The author moved it in the waiting order. */
    moved: boolean;
    /** When it finished gathering (the scheduler's order). */
    readyAt: number | null;
    endedAt: number | null;
    createdAt: number;
    updatedAt: number;
  };
}[T];

type Row = {
  key: string;
  type: ItemType;
  state: ItemState;
  target_key: string | null;
  data: string;
  moved: number;
  ready_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = "key, type, state, target_key, data, moved, ready_at, ended_at, created_at, updated_at";

function fromRow(r: Row): WorkRow {
  return {
    key: r.key,
    type: r.type,
    state: r.state,
    targetKey: r.target_key,
    data: JSON.parse(r.data),
    moved: r.moved === 1,
    readyAt: r.ready_at,
    endedAt: r.ended_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as WorkRow;
}

export type NewItem<T extends ItemType = ItemType> = {
  key: string;
  type: T;
  state: ItemState;
  data: DataOf[T];
  readyAt?: number | null;
};

/** Adds an item. Throws when the key is taken or the data does not fit the type. */
export function createItem<T extends ItemType>(item: NewItem<T>, now = Date.now()): WorkRow<T> {
  const data = DATA[item.type].parse(item.data);
  const targetOf = item.type === "picture" ? targetKey((data as PictureData).target as PictureTarget) : null;
  db()
    .prepare(`INSERT INTO work_items (${COLUMNS}) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`)
    .run(item.key, item.type, item.state, targetOf, JSON.stringify(data), item.readyAt ?? null, now, now);
  const created = getItem(item.key) as WorkRow<T>;
  publish(QUEUE_CHANNEL, { type: "item", item: created });
  return created;
}

export function getItem(key: string): WorkRow | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM work_items WHERE key = ?`).get(key) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Every item, oldest first, leaving out finished and failed ones that ended more than a week ago. */
export function listItems(now = Date.now()): WorkRow[] {
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM work_items
       WHERE NOT (state IN ('done', 'failed') AND COALESCE(ended_at, updated_at) < ?)
       ORDER BY created_at, rowid`,
    )
    .all(now - KEEP_ENDED_MS) as Row[];
  return rows.map(fromRow);
}

export type ItemPatch = {
  state?: ItemState;
  /** Fields of `data` to change, merged into what is there; a field set to undefined is removed. */
  data?: Record<string, unknown>;
  moved?: boolean;
  readyAt?: number | null;
  endedAt?: number | null;
};

/** Changes an item, checking the merged data; null when there is no such item. A state of done or failed sets `endedAt` unless given. */
export function updateItem(key: string, patch: ItemPatch, now = Date.now()): WorkRow | null {
  const d = db();
  const updated = d.transaction((): WorkRow | null => {
    const row = d.prepare(`SELECT ${COLUMNS} FROM work_items WHERE key = ?`).get(key) as Row | undefined;
    if (!row) return null;
    const merged: Record<string, unknown> = { ...JSON.parse(row.data) };
    for (const [k, v] of Object.entries(patch.data ?? {})) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const data = DATA[row.type].parse(merged);
    const state = patch.state ?? row.state;
    const ending = state === "done" || state === "failed";
    const endedAt = patch.endedAt !== undefined ? patch.endedAt : ending && row.ended_at === null ? now : ending ? row.ended_at : null;
    d.prepare(`UPDATE work_items SET state = ?, data = ?, moved = ?, ready_at = ?, ended_at = ?, updated_at = ? WHERE key = ?`).run(
      state,
      JSON.stringify(data),
      (patch.moved ?? row.moved === 1) ? 1 : 0,
      patch.readyAt !== undefined ? patch.readyAt : row.ready_at,
      endedAt,
      now,
      key,
    );
    return getItem(key);
  })();
  if (updated) publish(QUEUE_CHANNEL, { type: "item", item: updated });
  return updated;
}

/** Removes an item; false when there was none. */
export function deleteItem(key: string): boolean {
  const removed = db().prepare(`DELETE FROM work_items WHERE key = ?`).run(key).changes > 0;
  if (removed) publish(QUEUE_CHANNEL, { type: "removed", key });
  return removed;
}
