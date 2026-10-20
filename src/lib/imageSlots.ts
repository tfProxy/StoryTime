// A chapter's illustration slots. Pure code: used by the server and the browser.
// The header sits above the chapter's title and the footer after its text.

export const IMAGE_SLOTS = ["header", "footer"] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

/** Each slot's image version (when it was last set), or null when the slot is empty. */
export type ImageVersions = Record<ImageSlot, number | null>;

/**
 * What a saved picture was made from (null for an uploaded one). `job` is how ComfyUI was set when it
 * made the picture, or null when StoryTime no longer has that record, so there is no seed to bring back.
 */
export type ImageMade = {
  prompt: string;
  negative: string;
  job: { seed: number; checkpoint: string; width: number; height: number } | null;
};

export function isImageSlot(slot: string): slot is ImageSlot {
  return (IMAGE_SLOTS as readonly string[]).includes(slot);
}

/** The URL the browser loads a chapter image from; the version makes a replaced picture load afresh. */
export const chapterImageUrl = (chapterId: string, slot: ImageSlot, version: number) =>
  `/api/chapters/${chapterId}/images/${slot}?v=${version}`;
