import Link from "next/link";
import { notFound } from "next/navigation";
import IllustrateWorkspace from "@/components/IllustrateWorkspace";
import { chapterImageMade, chapterImageVersions } from "@/lib/chapterImages";
import { foldCodex } from "@/lib/codex";
import { getCodexOps } from "@/lib/codexDb";
import { chapterPictureJobs, storyChapterTitles } from "@/lib/pictureJobs";
import { chapterRefPool } from "@/lib/referencePool";
import { getPictureDraft } from "@/lib/pictureDrafts";
import { getChapterFixed, getChapterPreset, getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A posted chapter's pictures: one above its title and one after its text, and a prompt for making them.
// On a wide screen the chapter and the prompt are one column and the pictures the other.
export default async function IllustratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
  const before = path.at(-2);
  const story = getStory(chapter.story_id);
  if (!story) notFound();
  const versions = chapterImageVersions([chapter.id]).get(chapter.id)!;
  const codex = foldCodex(getCodexOps(chapter.id)).map((e) => ({
    id: e.entry_id,
    name: e.name,
    type: e.type,
    aliases: e.aliases,
    content: e.content,
    always_include: e.always_include,
  }));

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${id}`}>← Back to “{chapter.title}”</Link>
      </p>
      <h1>Illustrate “{chapter.title}”</h1>
      <IllustrateWorkspace
        chapterId={chapter.id}
        chapter={{
          chapterId: chapter.id,
          title: chapter.title,
          body: chapter.body,
          summary: chapter.summary,
          earlier: before ? before.path_summary || before.summary || null : null,
        }}
        titles={storyChapterTitles(story.id)}
        story={{
          id: story.id,
          title: story.title,
          premise: story.premise,
          art_style: story.art_style,
          draw_preset: story.draw_preset,
          style_ref: story.style_ref,
        }}
        chapterPreset={getChapterPreset(chapter.id)}
        path={path.map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary }))}
        codex={codex}
        pool={chapterRefPool(story.id, path, story.cover_version)}
        versions={versions}
        made={chapterImageMade(chapter.id)}
        draft={getPictureDraft(chapter.id)}
        fixedPrompt={getChapterFixed(chapter.id)}
        jobs={chapterPictureJobs(chapter.id)}
      />
    </>
  );
}
