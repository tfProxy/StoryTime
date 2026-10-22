import Link from "next/link";
import { notFound } from "next/navigation";
import CodexWorkspace from "@/components/CodexWorkspace";
import { codexEntryAt } from "@/lib/codexDb";
import { codexPictureAt, getCodexDraft, getCodexPreset } from "@/lib/codexPictures";
import { codexPictureJobs, storyChapterTitles } from "@/lib/pictureJobs";
import { codexRefPool } from "@/lib/referencePool";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A codex entry's picture, made like a chapter's pictures: a prompt written from the entry's text, pictures
// made from it on the ComfyUI machine, and one of them saved as the entry's picture from the start of the
// story or from a chapter on. `?at=<chapter id>` is the chapter the author came from: the entry's text and
// picture are as of that chapter, and a picture can be saved from it on.
export default async function CodexPicturePage({ params, searchParams }: { params: Promise<{ id: string; entryId: string }>; searchParams: Promise<{ at?: string }> }) {
  const { id, entryId } = await params;
  const { at: atParam } = await searchParams;
  const story = getStory(id);
  if (!story) notFound();
  // A chapter that isn't in this story is ignored.
  const path = atParam ? getPath(atParam) : [];
  const from = path.length > 0 && path[0].story_id === story.id ? path[path.length - 1] : null;
  const entry = codexEntryAt(story.id, entryId, from?.id ?? null);
  if (!entry) notFound();

  return (
    <>
      <p className="crumbs">
        {from ? <Link href={`/c/${from.id}/codex`}>← Back to the codex at “{from.title}”</Link> : <Link href={`/s/${story.id}/details`}>← Back to the details of “{story.title}”</Link>}
      </p>
      <h1>Picture of “{entry.name}”</h1>
      <CodexWorkspace
        story={{
          id: story.id,
          title: story.title,
          premise: story.premise,
          art_style: story.art_style,
          draw_preset: story.draw_preset,
        }}
        entry={{ id: entryId, name: entry.name, type: entry.type, aliases: entry.aliases, content: entry.content }}
        asOf={from?.title ?? null}
        entryPreset={getCodexPreset(story.id, entryId)}
        draft={getCodexDraft(story.id, entryId)}
        pool={codexRefPool(story.id, from?.id ?? null, story.cover_version)}
        titles={storyChapterTitles(story.id)}
        current={codexPictureAt(story.id, entryId, from?.id ?? null)}
        from={from ? { id: from.id, title: from.title } : null}
        jobs={codexPictureJobs(story.id, entryId)}
      />
    </>
  );
}
