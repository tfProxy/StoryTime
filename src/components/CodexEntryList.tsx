import Link from "next/link";
import { ENTRY_TYPES, TYPE_HEADINGS, TYPE_LABELS, type StoryEntrySummary } from "@/lib/codex";

/**
 * Every codex entry in a story, with filter links by type. `baseHref` must already contain a query
 * string (for example `/s/abc/review?tab=codex`); the type filter is added as `&type=<type>`.
 */
export default function CodexEntryList({
  storyId,
  entries,
  type,
  baseHref,
}: {
  storyId: string;
  entries: StoryEntrySummary[];
  type: string | null;
  baseHref: string;
}) {
  if (entries.length === 0) return <p>No codex entries yet.</p>;
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const shown = type ? entries.filter((e) => e.type === type) : entries;
  return (
    <section>
      <h2>Entries ({shown.length})</h2>
      <nav className="filter-links" aria-label="Filter entries by type">
        <Link href={baseHref} aria-current={type === null ? "page" : undefined}>
          All {entries.length}
        </Link>
        {ENTRY_TYPES.filter((t) => counts.has(t)).map((t) => (
          <Link key={t} href={`${baseHref}&type=${t}`} aria-current={type === t ? "page" : undefined}>
            {TYPE_HEADINGS[t]} {counts.get(t)}
          </Link>
        ))}
      </nav>
      {/* Each name opens the entry's page at the chapter where it was last changed. */}
      <ul className="entry-cards">
        {shown.map((e) => (
          <li key={e.entry_id}>
            <Link className="entry-card" href={`/s/${storyId}/codex/${e.entry_id}?at=${e.last_chapter_id}`}>
              <span className="entry-card-text">
                <strong>{e.name}</strong>
                <span className="meta entry-card-line">
                  {TYPE_LABELS[e.type]} · from {e.first_chapter_title}
                  {e.retired ? " · retired" : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
