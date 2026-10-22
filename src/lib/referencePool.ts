import { chapterImageVersions } from "./chapterImages";
import { IMAGE_SLOTS } from "./imageSlots";
import type { RefPool, SavedChoice } from "./comfy/referenceChoices";

// The saved pictures a picture page offers as references (see `referenceChoices`), read on the server.

/** The saved headers and footers of the chapters on the path (the page's own chapter last), then the story's cover. */
export function chapterRefPool(storyId: string, path: { id: string; title: string }[], coverVersion: number | null): RefPool {
  const versions = chapterImageVersions(path.map((c) => c.id));
  const saved: SavedChoice[] = path.flatMap((c) =>
    IMAGE_SLOTS.flatMap((slot) => {
      const version = versions.get(c.id)?.[slot] ?? null;
      return version === null ? [] : [{ chapterId: c.id, slot, version, title: c.title }];
    }),
  );
  if (coverVersion !== null) saved.push({ chapterId: null, slot: "cover", version: coverVersion, title: "" });
  return { storyId, parentId: path.at(-2)?.id ?? null, saved };
}

/** The cover page's pool: the saved cover only. */
export function coverRefPool(storyId: string, coverVersion: number | null): RefPool {
  return { storyId, parentId: null, saved: coverVersion === null ? [] : [{ chapterId: null, slot: "cover", version: coverVersion, title: "" }] };
}
