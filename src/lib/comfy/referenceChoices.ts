// Which pictures can be chosen as references on a picture page, and turning kept references back into
// pictures. Pure code (no React); the browser builds the pictures with `fromSaved` and `fromComfyImage`.
import type { ComfyImage } from "./client";
import { targetOfIds, type PictureMoment, type PictureSlot } from "../pictureTarget";
import { asReference, type Reference, type StoredReference } from "./references";
import { fromComfyImage, fromSaved, type StartPicture } from "./startPicture";

/** A saved header, footer or cover that can be a reference (`chapterId` null: the story's cover). */
export type SavedChoice = { chapterId: string | null; slot: PictureSlot; version: number; /** The chapter's title; empty for the cover. */ title: string };

/**
 * The saved pictures a page can offer: the headers and footers of the chapters on the path to the chapter
 * (first chapter first, the page's own chapter last), then the story's cover. `parentId` is the chapter
 * before the page's own, or null.
 */
export type RefPool = { storyId: string; parentId: string | null; saved: SavedChoice[] };

/** One picture on offer in the picker. */
export type RefChoice = { id: string; label: string; /** Said under the thumbnail. */ hint: string; /** The heading it is listed under. */ group: string; picture: StartPicture };

/** A picture that can be chosen: ComfyUI's picture, pinned. */
export type PinnedChoice = { image: ComfyImage };

const shortTitle = (title: string) => (title.length > 24 ? `${title.slice(0, 23).trimEnd()}…` : title);

const SLOT_WORDS: Record<PictureSlot, string> = { header: "header", footer: "footer", cover: "cover" };

/** The picture of a saved choice. */
export const savedPicture = (pool: RefPool, c: SavedChoice): StartPicture => fromSaved(targetOfIds(pool.storyId, c.chapterId),c.slot, c.version);

/** A saved picture's label as a reference: “Header”, “Footer”, “Cover”, or “Ch. <title> footer” for another chapter's. */
export function savedLabel(c: SavedChoice, ownChapterId: string | null): string {
  if (c.slot === "cover") return "Cover";
  if (c.chapterId === ownChapterId) return c.slot === "header" ? "Header" : "Footer";
  return `Ch. ${shortTitle(c.title)} ${SLOT_WORDS[c.slot]}`;
}

/** Where a kept reference's picture is, when it can be found again: a saved picture still there, or one of ComfyUI's. */
export function restoreReference(stored: StoredReference, ctx: { pool: RefPool; comfyUrl: string }): Reference | null {
  const { source } = stored;
  let picture: StartPicture | null = null;
  if (source.startsWith("saved:")) {
    const [, owner, slot] = source.split(":");
    const found = ctx.pool.saved.find((c) => c.slot === slot && (slot === "cover" ? owner === ctx.pool.storyId : c.chapterId === owner));
    if (found) picture = savedPicture(ctx.pool, found);
  } else if (source.startsWith("comfy:") && ctx.comfyUrl) {
    const path = source.slice("comfy:".length);
    const cut = path.lastIndexOf("/");
    picture = fromComfyImage(ctx.comfyUrl, { filename: path.slice(cut + 1), subfolder: cut < 0 ? "" : path.slice(0, cut), type: "output" });
  }
  return picture ? asReference(picture, stored.label, stored.role, stored.weight) : null;
}

/**
 * The pictures to offer: `suggested` are the ones that usually fit what is being made (making a footer, this
 * chapter's header; making a header, the previous chapter's footer and header; on the cover page, the saved
 * cover), `pictures` everything else that can be chosen: this page's pinned pictures, the headers and footers
 * on the path (latest first), and the cover. Only saved pictures that exist are offered.
 */
export function referenceChoices(opts: { pool: RefPool; chapterId: string | null; moment: PictureMoment; comfyUrl: string; pinned: PinnedChoice[] }): { suggested: RefChoice[]; pictures: RefChoice[] } {
  const { pool, chapterId, moment, comfyUrl, pinned } = opts;
  const saved = (c: SavedChoice, hint: string, group: string): RefChoice => {
    const picture = savedPicture(pool, c);
    return { id: picture.key, label: savedLabel(c, chapterId), hint, group, picture };
  };
  const find = (owner: string | null, slot: PictureSlot) => pool.saved.find((c) => c.chapterId === owner && c.slot === slot);
  const suggestedFrom: [SavedChoice | undefined, string][] =
    chapterId === null
      ? [[find(null, "cover"), "The saved cover"]]
      : moment === "end"
        ? [[find(chapterId, "header"), "This chapter's header"]]
        : [
            [pool.parentId ? find(pool.parentId, "footer") : undefined, "The previous chapter's footer"],
            [pool.parentId ? find(pool.parentId, "header") : undefined, "The previous chapter's header"],
            [find(chapterId, "footer"), "This chapter's footer"],
          ];
  const suggested = suggestedFrom.flatMap(([c, hint]) => (c ? [saved(c, hint, "Suggested")] : []));

  const pictures: RefChoice[] = [];
  if (comfyUrl) {
    for (const p of pinned) {
      const picture = fromComfyImage(comfyUrl, p.image);
      pictures.push({ id: picture.key, label: "Picture", hint: "Pinned on this page", group: "Pinned pictures", picture });
    }
  }
  // The path's headers and footers, the latest chapter first (a footer comes after its header in the chapter).
  const onPath = pool.saved.filter((c) => c.chapterId !== null).reverse();
  for (const c of onPath.slice(0, 10)) {
    pictures.push(saved(c, c.chapterId === chapterId ? "This chapter" : shortTitle(c.title), "Headers and footers on the path"));
  }
  const cover = find(null, "cover");
  if (cover) pictures.push(saved(cover, "The saved cover", "Cover"));
  const seen = new Set<string>();
  return { suggested, pictures: pictures.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))) };
}
