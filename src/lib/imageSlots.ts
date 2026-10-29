// A chapter's illustration slots. Pure code: used by the server and the browser.
// The header sits after the chapter's title, before its text, the middle picture at the paragraph break nearest the
// middle of the text, and the footer after its text.

export const IMAGE_SLOTS = ["header", "middle", "footer"] as const;
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
  /** Which picture of which job it is, when known (saved from a recorded job). */
  from: { jobId: string; index: number } | null;
};

export function isImageSlot(slot: string): slot is ImageSlot {
  return (IMAGE_SLOTS as readonly string[]).includes(slot);
}

/** The URL the browser loads a chapter image from; the version makes a replaced picture load afresh. */
export const chapterImageUrl = (chapterId: string, slot: ImageSlot, version: number) =>
  `/api/chapters/${chapterId}/images/${slot}?v=${version}`;

/** A chapter's paragraphs: its text split on blank lines, without empty ones. Shared so every page splits alike. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/**
 * How many paragraphs come before the middle picture: the paragraph break nearest (by characters) to half the
 * text, never inside a paragraph; the earlier break when two are equally near. With no paragraph break (0 or 1
 * paragraphs) the picture comes after the text.
 */
export function middleBreak(paragraphs: string[]): number {
  if (paragraphs.length <= 1) return paragraphs.length;
  const total = paragraphs.reduce((n, p) => n + p.trim().length, 0);
  let best = 1;
  let bestGap = Infinity;
  let before = 0;
  for (let i = 1; i < paragraphs.length; i++) {
    before += paragraphs[i - 1].trim().length;
    const gap = Math.abs(before * 2 - total);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}
