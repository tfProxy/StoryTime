import Link from "next/link";
import { notFound } from "next/navigation";
import ChapterImageEditor from "@/components/ChapterImageEditor";
import ImagePromptPanel from "@/components/ImagePromptPanel";
import { chapterImageVersions } from "@/lib/chapterImages";
import { foldCodex } from "@/lib/codex";
import { getCodexOps } from "@/lib/codexDb";
import { IMAGE_SLOTS } from "@/lib/imageSlots";
import { getPath, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A posted chapter's pictures: one above its title and one after its text, and a prompt for making them.
export default async function IllustratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const chapter = path[path.length - 1];
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
      <h1>Illustrate chapter</h1>
      <ImagePromptPanel
        chapterId={chapter.id}
        story={{ id: story.id, title: story.title, premise: story.premise, art_style: story.art_style }}
        path={path.map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary }))}
        codex={codex}
      />
      <div className="image-editors">
        {IMAGE_SLOTS.map((slot) => (
          <ChapterImageEditor key={slot} chapterId={chapter.id} slot={slot} version={versions[slot]} />
        ))}
      </div>
    </>
  );
}
