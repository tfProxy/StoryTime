import Link from "next/link";
import { notFound } from "next/navigation";
import CoverWorkspace from "@/components/CoverWorkspace";
import type { CoverChapter, CoverContext } from "@/components/CoverPromptPanel";
import { coverMade, getCoverDraft, getCoverPreset } from "@/lib/coverPictures";
import { getContextCodex } from "@/lib/codexDb";
import { coverPictureJobs, storyChapterTitles } from "@/lib/pictureJobs";
import { coverRefPool } from "@/lib/referencePool";
import { getPath, getStory } from "@/lib/stories";
import { getStoryTree, type TreeNode } from "@/lib/tree";

export const dynamic = "force-dynamic";

/** Every written chapter, in the outline's order (each chapter, then what follows it, choice by choice). */
function inOrder(node: TreeNode, parent: string | null = null, label: string | null = null): CoverChapter[] {
  return [{ id: node.id, title: node.title, parent_id: parent, label }, ...node.choices.flatMap((c) => (c.child ? inOrder(c.child, node.id, c.label) : []))];
}

/** The path from the first chapter to this one, and the codex there; null when the chapter is gone. */
function contextAt(chapterId: string, storyId: string): CoverContext | null {
  const path = getPath(chapterId);
  if (path.length === 0 || path[0].story_id !== storyId) return null;
  return {
    path: path.map((c) => ({ title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
    codex: getContextCodex(chapterId),
  };
}

// The story's cover, made like a chapter's pictures: a prompt written from the summary, the first
// chapter or a path through the story, pictures made from it on the ComfyUI machine, and one of them
// saved as the cover.
export default async function CoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  const tree = getStoryTree(story.id);
  const draft = getCoverDraft(story.id);
  const opening = story.root_chapter_id ? contextAt(story.root_chapter_id, story.id) : null;
  const savedPath = draft?.path_chapter_id ? contextAt(draft.path_chapter_id, story.id) : null;

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/details`}>← Back to the details of “{story.title}”</Link>
      </p>
      <h1>Make a cover</h1>
      <CoverWorkspace
        story={{
          id: story.id,
          title: story.title,
          premise: story.premise,
          art_style: story.art_style,
          draw_preset: story.draw_preset,
          style_ref: story.style_ref,
        }}
        coverPreset={getCoverPreset(story.id)}
        pool={coverRefPool(story.id, story.cover_version)}
        chapters={tree ? inOrder(tree) : []}
        opening={opening}
        // A path that ends at a chapter no longer in the story starts again from the last chapter listed.
        savedPath={savedPath}
        draft={draft && !savedPath && draft.path_chapter_id ? { ...draft, path_chapter_id: null } : draft}
        titles={storyChapterTitles(story.id)}
        version={story.cover_version}
        made={coverMade(story.id)}
        jobs={coverPictureJobs(story.id)}
      />
    </>
  );
}
