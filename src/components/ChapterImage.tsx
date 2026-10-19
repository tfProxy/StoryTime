import { chapterImageUrl, type ImageSlot } from "@/lib/imageSlots";

/** A chapter's header or footer picture, where the chapter is read. Nothing when the slot is empty. */
export default function ChapterImage({ chapterId, slot, version }: { chapterId: string; slot: ImageSlot; version: number | null }) {
  if (version === null) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size
    <img className={`chapter-image chapter-image-${slot}`} src={chapterImageUrl(chapterId, slot, version)} alt="" />
  );
}
