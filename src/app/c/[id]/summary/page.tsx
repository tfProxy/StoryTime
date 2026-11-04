import { notFound, redirect } from "next/navigation";
import { getChapter } from "@/lib/stories";

export const dynamic = "force-dynamic";

// A chapter's summary lives in the Story Bible now: its Summaries section, narrowed to this chapter.
export default async function SummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const { id } = await params;
  const { failed } = await searchParams;
  const chapter = getChapter(id);
  if (!chapter) notFound();
  redirect(`/s/${chapter.story_id}/review?tab=summaries&chapter=${id}${failed ? `&failed=${encodeURIComponent(failed)}` : ""}`);
}
