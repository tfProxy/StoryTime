import { getChapter, getChoices } from "@/lib/stories";

/** The chapters written after this one (its choices that have a chapter), for going forwards without the outline. */
export function nextChapters(chapterId: string): { id: string; title: string; label: string }[] {
  return getChoices(chapterId).flatMap((c) => {
    const child = c.child_chapter_id ? getChapter(c.child_chapter_id) : undefined;
    return child ? [{ id: child.id, title: child.title, label: c.label }] : [];
  });
}
