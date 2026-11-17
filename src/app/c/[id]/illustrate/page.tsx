import { permanentRedirect } from "next/navigation";
import { withQuery } from "@/lib/withQuery";

export const dynamic = "force-dynamic";

// The old Illustrate page: a chapter's pictures are made in the writing desk's Illustrate mode. Bookmarks and old links land there.
export default async function IllustratePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  permanentRedirect(withQuery(`/c/${encodeURIComponent(id)}/desk`, { ...(await searchParams), side: "illustrate" }));
}
