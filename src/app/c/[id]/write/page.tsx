import { permanentRedirect } from "next/navigation";
import { withQuery } from "@/lib/withQuery";

export const dynamic = "force-dynamic";

// The old Write page: the next chapter is written on the writing desk, with the same draft. `?choice=<id>` (an
// unwritten choice) stays as it is; without it the page added a new choice, which is the desk's `?new=`.
// Bookmarks, old links and drafts saved with this address land there.
export default async function WritePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const next = query.choice !== undefined || query.new !== undefined ? query : { ...query, new: "" };
  permanentRedirect(withQuery(`/c/${encodeURIComponent(id)}/desk`, next));
}
