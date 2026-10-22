import { chapterImageVersions } from "./chapterImages";
import { codexPictureIds, codexRefChoices } from "./codexPictures";
import { IMAGE_SLOTS } from "./imageSlots";
import type { RefPool, SavedChoice } from "./comfy/referenceChoices";

// The saved pictures a picture page offers as references (see `referenceChoices`), read on the server.

/**
 * The saved headers and footers of the chapters on the path (the page's own chapter last), then the story's
 * cover, and the codex entries that have a picture as of the path's last chapter.
 */
export function chapterRefPool(storyId: string, path: { id: string; title: string }[], coverVersion: number | null): RefPool {
  const versions = chapterImageVersions(path.map((c) => c.id));
  const saved: SavedChoice[] = path.flatMap((c) =>
    IMAGE_SLOTS.flatMap((slot) => {
      const version = versions.get(c.id)?.[slot] ?? null;
      return version === null ? [] : [{ chapterId: c.id, slot, version, title: c.title }];
    }),
  );
  if (coverVersion !== null) saved.push({ chapterId: null, slot: "cover", version: coverVersion, title: "" });
  return { storyId, parentId: path.at(-2)?.id ?? null, saved, codex: codexRefChoices(storyId, path.at(-1)?.id ?? null), codexIds: codexPictureIds(storyId) };
}

/** The cover page's pool: the saved cover only, and the codex entries with a picture from the start. */
export function coverRefPool(storyId: string, coverVersion: number | null): RefPool {
  return {
    storyId,
    parentId: null,
    saved: coverVersion === null ? [] : [{ chapterId: null, slot: "cover", version: coverVersion, title: "" }],
    codex: codexRefChoices(storyId, null),
    codexIds: codexPictureIds(storyId),
  };
}

/** The codex page's pool: the saved cover, and the codex entries' pictures as of the chapter it was opened from (or from the start). */
export function codexRefPool(storyId: string, atChapterId: string | null, coverVersion: number | null): RefPool {
  return { ...coverRefPool(storyId, coverVersion), codex: codexRefChoices(storyId, atChapterId) };
}
