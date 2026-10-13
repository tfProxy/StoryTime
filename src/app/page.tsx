import Link from "next/link";
import { listStories } from "@/lib/stories";

export const dynamic = "force-dynamic";

export default function Home() {
  const stories = listStories();
  return (
    <>
      <h1>Stories</h1>
      <p className="meta">Pick a story to read, or start your own.</p>
      <p>
        <Link className="button" href="/new">
          New story
        </Link>
      </p>
      {stories.length === 0 && (
        <p>Nothing here yet. Start the first story with the button above.</p>
      )}
      {stories.map((s) => (
        <Link key={s.id} href={`/s/${s.id}`} className="card">
          <strong>{s.title}</strong>
          <p className="meta">
            {s.author_name ? `by ${s.author_name} · ` : ""}
            {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"}
          </p>
        </Link>
      ))}
    </>
  );
}
