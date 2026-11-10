import { notFound } from "next/navigation";
import { getChapter, getStory } from "@/lib/stories";
import { getCodexState } from "@/lib/codexDb";
import { isAiFact } from "@/lib/codex";
import StoryTabs from "@/components/StoryTabs";
import CodexReview, { type AppliedFact } from "@/components/CodexReview";

export const dynamic = "force-dynamic";

// Reviewing the AI's codex changes from one chapter, beside the chapter's text: the one place they are decided.
// `?entry=<id>` shows only one entry's (from its page).
export default async function CodexReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string }> }) {
  const { id } = await params;
  const { entry } = await searchParams;
  const chapter = getChapter(id);
  if (!chapter) notFound();
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  // Facts the AI applied on its own at this chapter and the owner hasn't approved: decided here too.
  const applied: AppliedFact[] = getCodexState(id).flatMap((e) =>
    e.facts
      .filter((f) => isAiFact(f) && f.op.anchor_chapter_id === id)
      .map((f) => ({ op_id: f.op.id, entry_id: e.entry_id, entry_name: e.name, aspect: f.aspect, form: f.form, text: f.text, quote: f.quote })),
  );
  return (
    <>
      <StoryTabs storyId={story.id} title={story.title} active="read" />
      <CodexReview storyId={story.id} chapterId={id} title={chapter.title} body={chapter.body} applied={applied} entryId={entry ?? null} />
    </>
  );
}
