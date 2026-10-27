// The AI's verdicts on continuity clashes, kept so the same clash isn't asked about again. Keyed by a fingerprint of the
// two quotes (fact ids change every time a chapter is read). A verdict only counts while both chapters are still at the
// revision it was made for.
import { z } from "zod";
import { db } from "./db";
import { continuityFingerprint } from "./continuity";
import { getStory, PostError } from "./stories";

export const VERDICTS = ["contradiction", "change", "fine"] as const;
export type Verdict = (typeof VERDICTS)[number];

const field = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().min(1).max(100);

export const SaveVerdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  entity: field(80),
  attribute: field(60),
  before: z.object({ chapterId: id, revision: z.number().int().min(1), value: field(120), quote: field(240) }),
  after: z.object({ chapterId: id, revision: z.number().int().min(1), value: field(120), quote: field(240) }),
});

export type StoredVerdict = {
  fingerprint: string;
  verdict: Verdict;
  entity: string;
  attribute: string;
  before: { chapterId: string; revision: number; value: string; quote: string };
  after: { chapterId: string; revision: number; value: string; quote: string };
};

type Row = {
  fingerprint: string;
  verdict: Verdict;
  entity: string;
  attribute: string;
  before_chapter_id: string;
  before_revision: number;
  before_value: string;
  before_quote: string;
  after_chapter_id: string;
  after_revision: number;
  after_value: string;
  after_quote: string;
};

const toVerdict = (r: Row): StoredVerdict => ({
  fingerprint: r.fingerprint,
  verdict: r.verdict,
  entity: r.entity,
  attribute: r.attribute,
  before: { chapterId: r.before_chapter_id, revision: r.before_revision, value: r.before_value, quote: r.before_quote },
  after: { chapterId: r.after_chapter_id, revision: r.after_revision, value: r.after_value, quote: r.after_quote },
});

/** Every verdict stored for a story. */
export function storyVerdicts(storyId: string): StoredVerdict[] {
  return (db().prepare(`SELECT * FROM continuity_verdicts WHERE story_id = ? ORDER BY created_at, rowid`).all(storyId) as (Row & { story_id: string; created_at: number })[]).map(toVerdict);
}

/** Saves (or replaces) the verdict on one clash; returns its fingerprint. Both chapters must be in the story. */
export function saveVerdict(storyId: string, input: z.infer<typeof SaveVerdictSchema>): { fingerprint: string } {
  if (!getStory(storyId)) throw new PostError("That story does not exist", 404);
  const inStory = db().prepare(`SELECT 1 FROM chapters WHERE id = ? AND story_id = ?`);
  if (!inStory.get(input.before.chapterId, storyId) || !inStory.get(input.after.chapterId, storyId)) throw new PostError("That chapter is not in this story", 404);
  const fingerprint = continuityFingerprint(input.before.quote, input.after.quote);
  db()
    .prepare(
      `INSERT INTO continuity_verdicts (fingerprint, story_id, verdict, entity, attribute, before_chapter_id, before_revision, before_value, before_quote,
                                        after_chapter_id, after_revision, after_value, after_quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fingerprint) DO UPDATE SET story_id = excluded.story_id, verdict = excluded.verdict, entity = excluded.entity, attribute = excluded.attribute,
         before_chapter_id = excluded.before_chapter_id, before_revision = excluded.before_revision, before_value = excluded.before_value, before_quote = excluded.before_quote,
         after_chapter_id = excluded.after_chapter_id, after_revision = excluded.after_revision, after_value = excluded.after_value, after_quote = excluded.after_quote,
         created_at = excluded.created_at`,
    )
    .run(
      fingerprint,
      storyId,
      input.verdict,
      input.entity,
      input.attribute,
      input.before.chapterId,
      input.before.revision,
      input.before.value,
      input.before.quote,
      input.after.chapterId,
      input.after.revision,
      input.after.value,
      input.after.quote,
      Date.now(),
    );
  return { fingerprint };
}
