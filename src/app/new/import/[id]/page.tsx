import Link from "next/link";
import ImportReview from "@/components/ImportReview";

export const dynamic = "force-dynamic";

// The import of a story from text: its progress while the queue splits it, then the review of the chapters.
export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <p className="crumbs">
        <Link href="/">← Stories</Link>
      </p>
      <ImportReview id={id} />
    </>
  );
}
