import Link from "next/link";
import { notFound } from "next/navigation";
import { aiMarkOf, getChoices, getIncomingChoice, getPath, getStory, restoreBlocker, storyHasOriginal } from "@/lib/stories";
import AiMark from "@/components/AiMark";
import StoryTabs from "@/components/StoryTabs";
import TrashNotice from "@/components/TrashNotice";
import AiReviewNotice from "@/components/AiReviewNotice";
import CodexInboxBanner from "@/components/CodexInboxBanner";
import { appliedTagNames } from "@/lib/tags";
import { contentNotes } from "@/lib/contentNotes";
import type { ChapterNote } from "@/lib/contentNotesRoll";
import Prose from "@/components/Prose";
import ChapterActions from "@/components/ChapterActions";
import ChapterChoices from "@/components/ChapterChoices";
import ChapterImage from "@/components/ChapterImage";
import { chapterImageVersions } from "@/lib/chapterImages";
import { choiceDraftMarks, type DraftMark } from "@/lib/draftMarks";
import { getCodexState } from "@/lib/codexDb";
import { getSettings } from "@/lib/settingsStore";
import { parseSettings } from "@/lib/settingsSchema";
import ChapterMaking from "@/components/ChapterMaking";
import { getChapterWriting } from "@/lib/chapterWriting";
import { getKeptRequests } from "@/lib/keptRequests";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  const { id } = await params;
  const { posted } = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const ai = aiMarkOf(chapter);
  const choices = getChoices(chapter.id);
  // The choice the reader took to get here, for the prompt.
  const incoming = getIncomingChoice(chapter.id)?.label ?? null;
  const trashed = chapter.trashed_at !== null;
  const images = chapterImageVersions([chapter.id]).get(chapter.id)!;
  const tagNames = appliedTagNames(story.id, chapter.id).get(chapter.id) ?? [];
  const notes = choices.some((c) => c.child_chapter_id) ? contentNotes(story.id) : new Map<string, ChapterNote>();
  // With the "List the codex entries under a chapter's title" setting: the entries live at this chapter.
  const showCodex = (getSettings() ?? parseSettings({})).showCodexList;
  const codexEntries = showCodex ? getCodexState(chapter.id) : [];
  // Unwritten choices with a draft saved ("draft"), and written ones whose chapter has a draft not used (draftMarks.ts).
  const marks = trashed ? new Map<string, DraftMark>() : choiceDraftMarks(choices);
  // An imported story's original path: its choices are marked, unless the story's switch hides them.
  const hasOriginal = storyHasOriginal(story.id);

  return (
    <>
      <StoryTabs storyId={story.id} title={story.title} active="read" chapterId={chapter.id} />
      {trashed && <TrashNotice chapterId={chapter.id} blocker={restoreBlocker(chapter.id)} />}
      {posted && (
        <p className="notice">
          Chapter posted. Want the codex to catch up with what happened?{" "}
          <Link href={`/s/${story.id}/review?tab=codex&chapter=${chapter.id}&review=1`}>Review codex for this chapter</Link>
        </p>
      )}
      <CodexInboxBanner storyId={story.id} chapterId={chapter.id} />
      {ai === "unreviewed" && (
        <AiReviewNotice chapterId={chapter.id} pathUnreviewed={path.slice(0, -1).filter((p) => aiMarkOf(p) === "unreviewed").length} />
      )}
      {/* On the first chapter the trail would only repeat the title below. */}
      {path.length > 1 && (
        <nav className="crumbs" aria-label="Path so far">
          {path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && "› "}
              {i === path.length - 1 ? (
                <strong>{p.title}</strong>
              ) : (
                <Link href={`/c/${p.id}`}>{p.title}</Link>
              )}
            </span>
          ))}
        </nav>
      )}

      <h1>{chapter.title}</h1>
      {tagNames.length > 0 && <p className="meta chapter-tags">[{tagNames.join(", ")}]</p>}
      {showCodex && codexEntries.length > 0 && (
        <p className="meta chapter-tags chapter-codex" aria-label="Codex entries in this chapter">
          [
          {codexEntries.map((e, i) => (
            <span key={e.entry_id}>
              {i > 0 && ", "}
              <Link href={`/s/${story.id}/codex/${e.entry_id}?at=${chapter.id}`}>{e.name}</Link>
            </span>
          ))}
          ]
        </p>
      )}
      {(chapter.edited_at || ai) && (
        <p className="meta chapter-meta">
          {ai && (
            <span className="chapter-ai">
              <AiMark mark={ai} /> posted {new Date(chapter.posted_at).toISOString().slice(0, 10)}
            </span>
          )}
          {ai && chapter.edited_at && " · "}
          {chapter.edited_at && (
            <Link href={`/c/${chapter.id}/history`}>edited {new Date(chapter.edited_at).toISOString().slice(0, 10)}</Link>
          )}
        </p>
      )}
      <ChapterActions chapterId={chapter.id} storyId={story.id} trashed={trashed} summaryDone={!!(chapter.summary && chapter.path_summary)} />
      <ChapterImage chapterId={chapter.id} slot="header" version={images.header} />
      <Prose text={chapter.body} middle={<ChapterImage chapterId={chapter.id} slot="middle" version={images.middle} />} />
      <ChapterImage chapterId={chapter.id} slot="footer" version={images.footer} />
      <ChapterMaking requests={getKeptRequests(db(), getChapterWriting(chapter.id)?.ai ?? [])} />

      <ChapterChoices
        storyId={story.id}
        chapterId={chapter.id}
        choices={choices}
        incoming={incoming}
        marks={marks}
        notes={notes}
        trashed={trashed}
        hasOriginal={hasOriginal}
        showOriginal={story.show_original}
      />
    </>
  );
}
