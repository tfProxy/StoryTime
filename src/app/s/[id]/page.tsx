import { notFound, redirect } from "next/navigation";
import { getStory } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A story has no page of its own: its title leads straight to the first chapter, or to its details page
// (where the first chapter is started) while it has none. The outline and downloads are in the menu on each
// story in the list.
export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  redirect(story.root_chapter_id ? `/c/${story.root_chapter_id}` : `/s/${story.id}/details`);
}
