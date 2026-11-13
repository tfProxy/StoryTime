import { permanentRedirect } from "next/navigation";
import { withQuery } from "@/lib/withQuery";

export const dynamic = "force-dynamic";

// The old page for writing a story's first chapter: it is written on the writing desk, with the same draft.
// Bookmarks, old links and drafts saved with this address land there.
export default async function WriteFirstChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  permanentRedirect(withQuery(`/s/${encodeURIComponent(id)}/desk`, await searchParams));
}
