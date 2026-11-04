import { notFound, redirect } from "next/navigation";
import { getChapter } from "@/lib/stories";

export const dynamic = "force-dynamic";

// The codex of a chapter lives in the Story Bible now: its Codex section, narrowed to this chapter.
export default async function CodexPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const { id } = await params;
  const { review } = await searchParams;
  const chapter = getChapter(id);
  if (!chapter) notFound();
  redirect(`/s/${chapter.story_id}/review?tab=codex&chapter=${id}${review ? "&review=1" : ""}`);
}
