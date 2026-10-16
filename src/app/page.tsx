import Link from "next/link";
import { listStories } from "@/lib/stories";
import ImportStoryMenuItem from "@/components/ImportStoryMenuItem";
import { PageMenu } from "@/components/SiteMenu";

export const dynamic = "force-dynamic";

export default function Home() {
  const stories = listStories();
  const download = (id: string, format: string) => `/api/stories/${id}/export?format=${format}`;
  return (
    <>
      <h1>Stories</h1>
      <p className="meta">Pick a story to read, or start your own.</p>
      <p>
        <Link className="button" href="/new">
          New story
        </Link>
      </p>
      {stories.length === 0 && <p>Nothing here yet. Start the first story with the button above.</p>}
      {stories.map((s) => (
        <div key={s.id} className="card story-card">
          <Link href={s.root_chapter_id ? `/c/${s.root_chapter_id}` : `/s/${s.id}`} className="story-link">
            <strong>{s.title}</strong>
            {s.premise.trim() && <p className="meta story-premise">{s.premise.trim()}</p>}
            <p className="meta">
              {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"}
            </p>
          </Link>
          <div className="story-actions">
            <Link href={`/s/${s.id}/outline`} className="story-outline" aria-label={`Outline of ${s.title}`} title="Outline">
              <svg viewBox="0 0 24 24" width="1.2rem" height="1.2rem" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="5.5" r="2.2" /><circle cx="19" cy="18.5" r="2.2" /><path d="M7.2 12h3.3c2 0 2.5-6.5 6.3-6.5 M10.5 12c2 0 2.5 6.5 6.3 6.5" />
              </svg>
            </Link>
            <details className="story-menu">
              <summary aria-label={`Options for ${s.title}`}>☰</summary>
              <div className="story-menu-items">
                <a href={download(s.id, "md")}>Download readable (Markdown)</a>
                <a href={download(s.id, "html")}>Download to play offline (HTML)</a>
                <a href={download(s.id, "twee")}>Download Twine (Twee)</a>
                <a href={download(s.id, "json")}>Download everything (JSON)</a>
              </div>
            </details>
          </div>
        </div>
      ))}
      <PageMenu>
        <ImportStoryMenuItem />
      </PageMenu>
    </>
  );
}
