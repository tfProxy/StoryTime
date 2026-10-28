import { redirect } from "next/navigation";

// Redoing every summary is now the Summaries tab of the Story Bible.
export default async function SummariesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/s/${id}/review?tab=summaries`);
}
