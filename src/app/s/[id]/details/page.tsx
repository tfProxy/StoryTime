import Link from "next/link";
import { notFound } from "next/navigation";
import StoryTabs from "@/components/StoryTabs";
import CoverEditor from "@/components/CoverEditor";
import StoryDetailsForm from "@/components/StoryDetailsForm";
import StoryPictureSettings from "@/components/StoryPictureSettings";
import StoryTagSwitches from "@/components/StoryTagSwitches";
import { coverRefPool } from "@/lib/referencePool";
import { getChapter, getStory } from "@/lib/stories";
import { listTags, storyTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

// Settings for the whole story: its title, summary and style notes, its cover and its tags. (The codex is in the Story Bible.) Before the story has a chapter, it leads on to writing the first one; after, to reading it.
export default async function StoryDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  const root = story.root_chapter_id ? getChapter(story.root_chapter_id) : undefined;

  return (
    <>
    <StoryTabs storyId={story.id} title={story.title} active="details" />
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div>
        <h1>Story details</h1>
        <p className="meta">Settings for all of “{story.title}”, on every branch.</p>
        {/* Once there is a chapter, the Read tab leads to it; before that, this is the way in. */}
        {!root && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Link className="button" href={`/s/${story.id}/write`}>
              Start writing
            </Link>
            <span className="meta" style={{ margin: 0 }}>No chapters yet.</span>
          </div>
        )}
      </div>
      <StoryDetailsForm heading="Title, summary and style" story={{ id: story.id, title: story.title, premise: story.premise, style: story.style }} />
      <StoryPictureSettings
        story={{ id: story.id, art_style: story.art_style, draw_preset: story.draw_preset, style_ref: story.style_ref }}
        pool={coverRefPool(story.id, story.cover_version)}
      />
      <CoverEditor story={{ id: story.id, title: story.title, cover_version: story.cover_version }} />
      <StoryTagSwitches storyId={story.id} tags={listTags().map((t) => ({ id: t.id, name: t.name, applies: t.applies }))} enabled={storyTags(story.id)} />
      {/* Nothing to download until the first chapter is written. */}
      {root && (
        <section className="ai-panel" aria-labelledby="export-heading">
          <h2 id="export-heading">Export</h2>
          <p className="meta">Download the whole story, every branch.</p>
          <ul className="export-links">
            <li>
              <a href={`/api/stories/${story.id}/export?format=md`}>Readable (Markdown)</a>
            </li>
            <li>
              <a href={`/api/stories/${story.id}/export?format=html`}>To play offline (HTML)</a>
            </li>
            <li>
              <a href={`/api/stories/${story.id}/export?format=twee`}>Twine (Twee)</a>
            </li>
            <li>
              <a href={`/api/stories/${story.id}/export?format=json`}>Everything (JSON)</a>
            </li>
            <li>
              <a href={`/api/chapters/${root.id}/codex?format=md`}>Codex (Markdown)</a>
            </li>
          </ul>
        </section>
      )}
    </div>
    </>
  );
}
