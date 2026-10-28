import { notFound, redirect } from "next/navigation";
import { getPath } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The ☰ menu's Story Bible link on a chapter page: the chapter's story, with the Bible narrowed to this chapter.
export default async function ChapterBiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getPath(id);
  if (path.length === 0) notFound();
  redirect(`/s/${path[path.length - 1].story_id}/review?chapter=${id}`);
}
