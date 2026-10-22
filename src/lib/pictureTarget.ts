// What pictures are made for: one of a chapter's moments, or the story's cover. Shared by the picture
// queue, ComfyUI's job tags and the pages that make pictures. Pure code, safe on the server and in the browser.
import type { ImageMoment } from "./ai/imagePrompt";
import { chapterImageUrl, IMAGE_SLOTS, type ImageSlot } from "./imageSlots";

/** Which picture a job is for: a chapter's start or end, or the story's cover. */
export type PictureMoment = ImageMoment | "cover";

/** A chapter (`chapterId`), or the story's cover (`chapterId` null). */
export type PictureTarget = { storyId: string; chapterId: string | null };

/** One string per target, for maps and keys: `chapter:<id>` or `cover:<story id>`. */
export const targetKey = (t: PictureTarget) => (t.chapterId === null ? `cover:${t.storyId}` : `chapter:${t.chapterId}`);

/** Where a picture can be saved: a chapter's header or footer, or the story's cover. */
export type PictureSlot = ImageSlot | "cover";

/** The slots a target's pictures can be saved in. */
export const slotsFor = (t: PictureTarget): readonly PictureSlot[] => (t.chapterId === null ? ["cover"] : IMAGE_SLOTS);

/** Where a saved picture is kept: a chapter's header or footer, or the story's cover. */
export const savedPictureApi = (t: PictureTarget, slot: PictureSlot) =>
  slot === "cover" ? `/api/stories/${t.storyId}/cover` : `/api/chapters/${t.chapterId}/images/${slot}`;

/** The URL the browser loads a saved picture from; the version makes a replaced one load afresh. */
export const savedPictureUrl = (t: PictureTarget, slot: PictureSlot, version: number) =>
  slot === "cover" ? `${savedPictureApi(t, slot)}?v=${version}` : chapterImageUrl(t.chapterId!, slot, version);

/** What the cover's prompt is written from: the premise and codex, those and the first chapter, or a path through the story. */
export const COVER_SOURCES = ["premise", "opening", "path"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

/** The page that makes the target's pictures. */
export const targetHref = (t: PictureTarget) => (t.chapterId === null ? `/s/${t.storyId}/cover` : `/c/${t.chapterId}/illustrate`);
