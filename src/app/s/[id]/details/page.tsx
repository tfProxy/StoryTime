import Link from "next/link";
import { notFound } from "next/navigation";
import CodexPanel from "@/components/CodexPanel";
import CoverEditor from "@/components/CoverEditor";
import StoryDetailsForm from "@/components/StoryDetailsForm";
import StoryPictureSettings from "@/components/StoryPictureSettings";
import StoryTagSwitches from "@/components/StoryTagSwitches";
import { getCodexOps } from "@/lib/codexDb";
import { coverRefPool } from "@/lib/referencePool";
import { getChapter, getStory } from "@/lib/stories";
import { listTags, storyTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

// Settings for the whole story: its title, summary and style notes, its cover, and the codex entries every
// branch shares. Before the story has a chapter, it leads on to writing the first one; after, to reading it.
export default async function StoryDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  const root = story.root_chapter_id ? getChapter(story.root_chapter_id) : undefined;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div>
        <p className="crumbs">
          <Link href="/">← Stories</Link>
        </p>
        <h1>Story details</h1>
        <p className="meta">Settings for all of “{story.title}”, on every branch.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {root ? (
            <Link className="button" href={`/c/${root.id}`}>
              Read “{story.title}”
            </Link>
          ) : (
            <>
              <Link className="button" href={`/s/${story.id}/write`}>
                Start writing
              </Link>
              <span className="meta" style={{ margin: 0 }}>No chapters yet.</span>
            </>
          )}
        </div>
      </div>
      <StoryDetailsForm heading="Title, summary and style" story={{ id: story.id, title: story.title, premise: story.premise, style: story.style }} />
      <StoryPictureSettings
        story={{ id: story.id, art_style: story.art_style, draw_preset: story.draw_preset, style_ref: story.style_ref }}
        pool={coverRefPool(story.id, story.cover_version)}
      />
      <CoverEditor story={{ id: story.id, title: story.title, cover_version: story.cover_version }} />
      <StoryTagSwitches storyId={story.id} tags={listTags().map((t) => ({ id: t.id, name: t.name, applies: t.applies }))} enabled={storyTags(story.id)} />
      <section className="ai-panel">
        <h2>Codex</h2>
        {root ? (
          <>
            <p className="meta">
              Characters, places and facts the AI keeps in mind.{" "}
              <a href={`/api/chapters/${root.id}/codex?format=md`}>Download as Markdown</a>
            </p>
            <CodexPanel
              storyWide
              story={{ title: story.title, premise: story.premise }}
              storyId={story.id}
              chapterId={root.id}
              path={[
                {
                  id: root.id,
                  title: root.title,
                  depth: root.depth,
                  body: root.body,
                  summary: root.summary,
                  path_summary: root.path_summary,
                },
              ]}
              ops={getCodexOps(root.id)}
            />
          </>
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            Characters, places and facts the AI keeps in mind. Entries can be added here once the first chapter is posted.
          </p>
        )}
      </section>
    </div>
  );
}
