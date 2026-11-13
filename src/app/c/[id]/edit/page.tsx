import { permanentRedirect } from "next/navigation";
import { withQuery } from "@/lib/withQuery";

export const dynamic = "force-dynamic";

// The old Edit page: a chapter is edited on the writing desk, with the same draft. Bookmarks and old links land there.
export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  permanentRedirect(withQuery(`/c/${encodeURIComponent(id)}/desk`, await searchParams));
}
