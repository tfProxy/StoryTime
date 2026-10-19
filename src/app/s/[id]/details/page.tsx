import Link from "next/link";
import { notFound } from "next/navigation";
import CodexPanel from "@/components/CodexPanel";
import CoverEditor from "@/components/CoverEditor";
import StoryDetailsForm from "@/components/StoryDetailsForm";
import { getCodexOps } from "@/lib/codexDb";
import { getChapter, getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Settings for the whole story: its title, summary and style notes, and the codex entries every branch shares.
export default async function StoryDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  const root = story?.root_chapter_id ? getChapter(story.root_chapter_id) : undefined;
  if (!story || !root) notFound();

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div>
        <p className="crumbs">
          <Link href="/">← Stories</Link>
          <Link href={`/c/${root.id}`}>Read “{story.title}”</Link>
        </p>
        <h1>Story details</h1>
        <p className="meta">Settings for all of “{story.title}”, on every branch.</p>
      </div>
      <StoryDetailsForm heading="Title, summary and style" story={{ id: story.id, title: story.title, premise: story.premise, style: story.style }} />
      <CoverEditor story={{ id: story.id, title: story.title, cover_version: story.cover_version }} />
      <section className="ai-panel">
        <h2>Codex</h2>
        <p className="meta">
          Characters, places and facts the AI keeps in mind.{" "}
          <a href={`/api/chapters/${root.id}/codex?format=md`}>Download as Markdown</a>
        </p>
        <CodexPanel
          storyWide
          story={{ title: story.title, premise: story.premise }}
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
      </section>
    </div>
  );
}
