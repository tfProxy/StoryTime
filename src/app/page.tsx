import Link from "next/link";
import { listStories } from "@/lib/stories";

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
            <p className="meta">
              {s.author_name ? `by ${s.author_name} · ` : ""}
              {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"}
            </p>
          </Link>
          <details className="story-menu">
            <summary aria-label={`Options for ${s.title}`}>☰</summary>
            <div className="story-menu-items">
              <Link href={`/s/${s.id}/outline`}>Outline</Link>
              <a href={download(s.id, "md")}>Download readable (Markdown)</a>
              <a href={download(s.id, "html")}>Download to play offline (HTML)</a>
              <a href={download(s.id, "twee")}>Download Twine (Twee)</a>
              <a href={download(s.id, "json")}>Download everything (JSON)</a>
            </div>
          </details>
        </div>
      ))}
    </>
  );
}
