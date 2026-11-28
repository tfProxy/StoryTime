import { redirect } from "next/navigation";

// The page that reviewed a chapter's codex changes beside its text is gone: they are reviewed on the chapter's writing
// desk, in each entry's Facts tab ("Changed in this chapter", Approve and Undo) and Suggestions tab. Old links land
// there, `?entry=<id>` opening that entry.
export default async function CodexReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string }> }) {
  const { id } = await params;
  const { entry } = await searchParams;
  redirect(`/c/${id}/desk${entry ? `?entry=${encodeURIComponent(entry)}` : ""}`);
}
