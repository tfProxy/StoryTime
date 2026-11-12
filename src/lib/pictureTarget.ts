// What pictures are made for: one of a chapter's moments, the story's cover, or a codex entry. Shared by the
// picture queue, ComfyUI's job tags and the pages that make pictures. Pure code, safe on the server and in the browser.
import type { ImageMoment } from "./ai/imagePrompt";
import { chapterImageUrl, IMAGE_SLOTS, type ImageSlot } from "./imageSlots";

/** Which picture a job is for: a chapter's start or end, the story's cover, or a codex entry. */
export type PictureMoment = ImageMoment | "cover" | "codex";

/**
 * A chapter's pictures, the story's cover, or a codex entry's pictures: what a page makes pictures for. Ask
 * the target (the helpers below) rather than checking its kind. No page makes a codex entry's pictures any more (an
 * entry has an icon instead, see ../codexIcons): that kind is for the jobs made for one before, which are still in the
 * job log and may still be in ComfyUI's queue. Nothing can be saved for it.
 */
export type PictureTarget =
  | { kind: "chapter"; storyId: string; chapterId: string }
  | { kind: "cover"; storyId: string }
  | { kind: "codex"; storyId: string; entryId: string };

export const chapterTarget = (storyId: string, chapterId: string): PictureTarget => ({ kind: "chapter", storyId, chapterId });
export const coverTarget = (storyId: string): PictureTarget => ({ kind: "cover", storyId });
export const codexTarget = (storyId: string, entryId: string): PictureTarget => ({ kind: "codex", storyId, entryId });

/**
 * The target for the ids that job tags and the job log carry: a chapter's id, or null for the story's cover
 * (or, given an entry id, for that codex entry). The stored formats are unchanged by there being kinds.
 */
export const targetOfIds = (storyId: string, chapterId: string | null, entryId?: string | null): PictureTarget =>
  chapterId !== null ? chapterTarget(storyId, chapterId) : entryId ? codexTarget(storyId, entryId) : coverTarget(storyId);

/** The chapter id the stored formats carry for a target: null for the cover and for a codex entry. */
export const chapterIdOf = (t: PictureTarget): string | null => (t.kind === "chapter" ? t.chapterId : null);

/** The codex entry id the stored formats carry for a target: null unless it is a codex entry. */
export const entryIdOf = (t: PictureTarget): string | null => (t.kind === "codex" ? t.entryId : null);

/** One string per target, for maps and keys: `chapter:<id>`, `cover:<story id>` or `codex:<entry id>`. */
export const targetKey = (t: PictureTarget) => (t.kind === "chapter" ? `chapter:${t.chapterId}` : t.kind === "cover" ? `cover:${t.storyId}` : `codex:${t.entryId}`);

/** The slots that are one saved image of a chapter or the story. */
export type SavedSlot = ImageSlot | "cover";

/** Where a picture can be saved: a chapter's header, middle or footer, or the story's cover. */
export type PictureSlot = SavedSlot;

/** The slots a target's pictures can be saved in (none for a codex entry's). */
export const slotsFor = (t: PictureTarget): readonly PictureSlot[] => (t.kind === "chapter" ? IMAGE_SLOTS : t.kind === "cover" ? ["cover"] : []);

/** Where a saved picture is kept: a chapter's header or footer, or the story's cover (PUT an image to it). */
export function savedPictureApi(t: PictureTarget, slot: PictureSlot): string {
  if (t.kind === "codex") throw new Error("Nothing is saved for a codex entry's picture job");
  return t.kind === "cover" ? `/api/stories/${t.storyId}/cover` : `/api/chapters/${t.chapterId}/images/${slot}`;
}

/** The URL the browser loads a saved picture from; the version makes a replaced one load afresh. */
export function savedPictureUrl(t: PictureTarget, slot: PictureSlot, version: number): string {
  if (t.kind === "codex") throw new Error("Nothing is saved for a codex entry's picture job");
  return t.kind === "cover" || slot === "cover" ? `${savedPictureApi(t, slot)}?v=${version}` : chapterImageUrl(t.chapterId, slot, version);
}

/** Who owns a saved picture, as in a `saved:<owner>:<slot>` source: the chapter's id, or the story's for the cover. */
export const savedOwner = (t: PictureTarget) => (t.kind === "chapter" ? t.chapterId : t.kind === "cover" ? t.storyId : t.entryId);

/** What the cover's prompt is written from: the premise and codex, those and the first chapter, or a path through the story. */
export const COVER_SOURCES = ["premise", "opening", "path"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

/** The page that makes the target's pictures (for a codex entry's old jobs, the entry's page, where its icon is). */
export const targetHref = (t: PictureTarget) =>
  t.kind === "chapter" ? `/c/${t.chapterId}/illustrate` : t.kind === "cover" ? `/s/${t.storyId}/cover` : `/s/${t.storyId}/codex/${encodeURIComponent(t.entryId)}`;

/** What the target's own preset and kept settings are called in a message: "chapter", "cover" or "codex entry". */
export const targetWord = (t: PictureTarget) => (t.kind === "chapter" ? "chapter" : t.kind === "cover" ? "cover" : "codex entry");

/** The API that keeps the target's own drawing preset. */
export function presetApi(t: PictureTarget): string {
  if (t.kind === "codex") throw new Error("A codex entry has no drawing preset");
  return t.kind === "chapter" ? `/api/chapters/${t.chapterId}/picture-preset` : `/api/stories/${t.storyId}/cover-preset`;
}

/** Which of the story's other pictures the "other" view lists: every chapter's (for the cover and codex pages), or the other chapters'. */
export const othersQuery = (t: PictureTarget) =>
  `story=${encodeURIComponent(t.storyId)}&${t.kind === "chapter" ? `not_chapter=${encodeURIComponent(t.chapterId)}` : "chapters=1"}`;
