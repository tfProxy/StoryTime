import Link from "next/link";

export type StoryTab = "read" | "outline" | "bible" | "pictures" | "details";

// The tab bar at the top of a story's own pages (reading, outline, Story Bible, pictures, details). The page
// says which tab it belongs to. Full-screen editors don't show it. Read opens the first chapter.
export default function StoryTabs({ storyId, title, active }: { storyId: string; title: string; active: StoryTab }) {
  const tabs: { key: StoryTab; label: string; href: string }[] = [
    { key: "read", label: "Read", href: `/s/${storyId}` },
    { key: "outline", label: "Outline", href: `/s/${storyId}/outline` },
    { key: "bible", label: "Bible", href: `/s/${storyId}/review` },
    { key: "pictures", label: "Pictures", href: `/s/${storyId}/pictures` },
    { key: "details", label: "Details", href: `/s/${storyId}/details` },
  ];
  return (
    <div className="story-tabs-wrap">
      <p className="story-tabs-title" title={title}>
        {title}
      </p>
      <nav className="story-tabs" aria-label="Story">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
