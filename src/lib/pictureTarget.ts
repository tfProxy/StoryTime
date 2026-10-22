// What pictures are made for: one of a chapter's moments, or the story's cover. Shared by the picture
// queue, ComfyUI's job tags and the pages that make pictures. Pure code, safe on the server and in the browser.
import type { ImageMoment } from "./ai/imagePrompt";
import { chapterImageUrl, IMAGE_SLOTS, type ImageSlot } from "./imageSlots";

/** Which picture a job is for: a chapter's start or end, or the story's cover. */
export type PictureMoment = ImageMoment | "cover";

/** A chapter's pictures, or the story's cover: what a page makes pictures for. Ask the target (the helpers below) rather than checking its kind. */
export type PictureTarget = { kind: "chapter"; storyId: string; chapterId: string } | { kind: "cover"; storyId: string };

export const chapterTarget = (storyId: string, chapterId: string): PictureTarget => ({ kind: "chapter", storyId, chapterId });
export const coverTarget = (storyId: string): PictureTarget => ({ kind: "cover", storyId });

/**
 * The target for the ids that job tags and the job log carry: a chapter's id, or null for the story's
 * cover (the stored formats are unchanged).
 */
export const targetOfIds = (storyId: string, chapterId: string | null): PictureTarget =>
  chapterId === null ? coverTarget(storyId) : chapterTarget(storyId, chapterId);

/** The chapter id the stored formats carry for a target: null for the cover. */
export const chapterIdOf = (t: PictureTarget): string | null => (t.kind === "chapter" ? t.chapterId : null);

/** One string per target, for maps and keys: `chapter:<id>` or `cover:<story id>`. */
export const targetKey = (t: PictureTarget) => (t.kind === "chapter" ? `chapter:${t.chapterId}` : `cover:${t.storyId}`);

/** Where a picture can be saved: a chapter's header or footer, or the story's cover. */
export type PictureSlot = ImageSlot | "cover";

/** The slots a target's pictures can be saved in. */
export const slotsFor = (t: PictureTarget): readonly PictureSlot[] => (t.kind === "chapter" ? IMAGE_SLOTS : ["cover"]);

/** Where a saved picture is kept: a chapter's header or footer, or the story's cover. */
export const savedPictureApi = (t: PictureTarget, slot: PictureSlot) =>
  t.kind === "cover" ? `/api/stories/${t.storyId}/cover` : `/api/chapters/${t.chapterId}/images/${slot}`;

/** The URL the browser loads a saved picture from; the version makes a replaced one load afresh. */
export const savedPictureUrl = (t: PictureTarget, slot: PictureSlot, version: number) =>
  t.kind === "cover" || slot === "cover" ? `${savedPictureApi(t, slot)}?v=${version}` : chapterImageUrl(t.chapterId, slot, version);

/** Who owns a saved picture, as in a `saved:<owner>:<slot>` source: the chapter's id, or the story's for the cover. */
export const savedOwner = (t: PictureTarget) => (t.kind === "chapter" ? t.chapterId : t.storyId);

/** What the cover's prompt is written from: the premise and codex, those and the first chapter, or a path through the story. */
export const COVER_SOURCES = ["premise", "opening", "path"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

/** The page that makes the target's pictures. */
export const targetHref = (t: PictureTarget) => (t.kind === "chapter" ? `/c/${t.chapterId}/illustrate` : `/s/${t.storyId}/cover`);

/** What the target's own preset and kept settings are called in a message: "chapter" or "cover". */
export const targetWord = (t: PictureTarget) => (t.kind === "chapter" ? "chapter" : "cover");

/** The API that keeps the target's own drawing preset. */
export const presetApi = (t: PictureTarget) => (t.kind === "chapter" ? `/api/chapters/${t.chapterId}/picture-preset` : `/api/stories/${t.storyId}/cover-preset`);

/** Which of the story's other pictures the "other" view lists: every chapter's (for the cover), or the other chapters'. */
export const othersQuery = (t: PictureTarget) =>
  `story=${encodeURIComponent(t.storyId)}&${t.kind === "chapter" ? `not_chapter=${encodeURIComponent(t.chapterId)}` : "chapters=1"}`;
