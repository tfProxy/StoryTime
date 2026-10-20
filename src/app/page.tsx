import Link from "next/link";
import { listStories } from "@/lib/stories";
import ImportStoryMenuItem from "@/components/ImportStoryMenuItem";
import { PageMenu } from "@/components/SiteMenu";
import StoryCover from "@/components/StoryCover";
import StorySummary from "@/components/StorySummary";
import StoryMenu from "@/components/StoryMenu";

export const dynamic = "force-dynamic";

export default function Home() {
  const stories = listStories();
  const download = (id: string, format: string) => `/api/stories/${id}/export?format=${format}`;
  return (
    <div className="library">
      <h1>Stories</h1>
      <p className="meta">Pick a story to read, or start your own.</p>
      {stories.length === 0 && <p>Nothing here yet. Start the first story with the New story button.</p>}
      <ul className="story-grid">
        {stories.map((s) => (
          <li key={s.id} className="story-card">
            <Link href={s.root_chapter_id ? `/c/${s.root_chapter_id}` : `/s/${s.id}/details`} className="story-link">
              <StoryCover story={s} />
              <strong className="story-title">{s.title}</strong>
            </Link>
            {/* Takes the row's spare height, so the chapter counts line up across a row. */}
            <div className="story-summary">{s.premise.trim() && <StorySummary text={s.premise.trim()} />}</div>
            <span className="meta story-count">
              {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"}
            </span>
            <div className="story-actions">
              {s.root_chapter_id && (
                <Link href={`/s/${s.id}/outline`} className="story-outline" aria-label={`Outline of ${s.title}`} title="Outline">
                  <svg viewBox="0 0 24 24" width="1.2rem" height="1.2rem" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="5.5" r="2.2" /><circle cx="19" cy="18.5" r="2.2" /><path d="M7.2 12h3.3c2 0 2.5-6.5 6.3-6.5 M10.5 12c2 0 2.5 6.5 6.3 6.5" />
                  </svg>
                </Link>
              )}
              <StoryMenu label={`Options for ${s.title}`}>
                <Link href={`/s/${s.id}/details`}>Story details</Link>
                {/* Nothing to download until the first chapter is written. */}
                {s.root_chapter_id && (
                  <>
                    <a href={download(s.id, "md")}>Download readable (Markdown)</a>
                    <a href={download(s.id, "html")}>Download to play offline (HTML)</a>
                    <a href={download(s.id, "twee")}>Download Twine (Twee)</a>
                    <a href={download(s.id, "json")}>Download everything (JSON)</a>
                  </>
                )}
              </StoryMenu>
            </div>
          </li>
        ))}
      </ul>
      <Link className="button new-story" href="/new">
        <span aria-hidden="true">+</span> New story
      </Link>
      <PageMenu>
        <ImportStoryMenuItem />
      </PageMenu>
    </div>
  );
}
