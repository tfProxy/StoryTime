import Link from "next/link";
import { notFound } from "next/navigation";
import { aiMarkOf, choiceDraftKey, getChoices, getIncomingChoice, getPath, getStory, restoreBlocker } from "@/lib/stories";
import AiMark from "@/components/AiMark";
import StoryTabs from "@/components/StoryTabs";
import TrashNotice from "@/components/TrashNotice";
import AiReviewNotice from "@/components/AiReviewNotice";
import CodexInboxBanner from "@/components/CodexInboxBanner";
import { appliedTagNames } from "@/lib/tags";
import { contentNotes } from "@/lib/contentNotes";
import { noteText, type ChapterNote } from "@/lib/contentNotesRoll";
import Prose from "@/components/Prose";
import ChapterActions from "@/components/ChapterActions";
import AddChoice from "@/components/AddChoice";
import RemoveChoice from "@/components/RemoveChoice";
import SuggestChoices from "@/components/SuggestChoices";
import ChapterImage from "@/components/ChapterImage";
import { chapterImageVersions } from "@/lib/chapterImages";
import { draftKeysSaved } from "@/lib/draftStore";
import { getCodexState } from "@/lib/codexDb";
import { getSettings } from "@/lib/settingsStore";
import { parseSettings } from "@/lib/settingsSchema";

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
  // Unwritten choices with a draft saved (the write page keys a choice's draft "fill:<choice id>").
  // With the "List the codex entries under a chapter's title" setting: the entries live at this chapter.
  const showCodex = (getSettings() ?? parseSettings({})).showCodexList;
  const codexEntries = showCodex ? getCodexState(chapter.id) : [];
  const drafted = trashed ? new Set<string>() : draftKeysSaved(choices.filter((c) => !c.child_chapter_id).map((c) => choiceDraftKey(c.id)));

  return (
    <>
      <StoryTabs storyId={story.id} title={story.title} active="read" />
      {trashed && <TrashNotice chapterId={chapter.id} blocker={restoreBlocker(chapter.id)} />}
      {posted && (
        <p className="notice">
          Chapter posted. Want the codex to catch up with what happened?{" "}
          <Link href={`/c/${chapter.id}/codex?review=1`}>Review codex for this chapter</Link>
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

      <section className="choices">
        <h2>{choices.length > 0 ? "What happens next?" : "The story ends here, for now."}</h2>
        {choices.map((c) =>
          trashed ? (
            // Nothing is written below a chapter in the trash; restore the branch first.
            <div key={c.id} className="card choice-unwritten">
              {c.label}
            </div>
          ) : c.child_chapter_id ? (
            <Link key={c.id} href={`/c/${c.child_chapter_id}`} className="card choice-written" title="Written">
              <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z M12 6v13" />
              </svg>
              {c.label}
              {c.child_ai && (
                <span className="choice-ai">
                  <AiMark mark={c.child_ai} />
                </span>
              )}
              {noteText(notes.get(c.child_chapter_id)) && (
                <span className="choice-note">{noteText(notes.get(c.child_chapter_id))}</span>
              )}
            </Link>
          ) : (
            <div key={c.id} className="choice-slot">
              <Link
                href={`/c/${chapter.id}/write?choice=${c.id}`}
                className="card choice-unwritten"
                title={drafted.has(choiceDraftKey(c.id)) ? "Not written yet, but a draft is saved. Carry on with it?" : "Not written yet. Write it?"}
              >
                <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z M14.5 6.5l3 3" />
                </svg>
                {c.label}
                {drafted.has(choiceDraftKey(c.id)) && (
                  <span className="choice-draft">
                    {/* A page with lines of text: the choice has a draft saved. */}
                    <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6" />
                    </svg>
                    <span className="visually-hidden">(draft saved)</span>
                  </span>
                )}
              </Link>
              <RemoveChoice chapterId={chapter.id} choiceId={c.id} label={c.label} />
            </div>
          ),
        )}
        {!trashed && (
          <>
            <AddChoice chapterId={chapter.id} />
            <SuggestChoices storyId={story.id} chapterId={chapter.id} incoming={incoming} choices={choices.map((c) => c.label)} />
          </>
        )}
      </section>
    </>
  );
}
