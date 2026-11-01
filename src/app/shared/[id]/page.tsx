import Link from "next/link";
import { notFound } from "next/navigation";
import SharedEntryEditor from "@/components/SharedEntryEditor";
import { TYPE_LABELS } from "@/lib/codex";
import { getSharedEntry, sharedEntryUsage } from "@/lib/sharedCodex";

export const dynamic = "force-dynamic";

export default async function SharedEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getSharedEntry(id);
  if (!entry) notFound();
  return (
    <>
      <p className="crumbs">
        <Link href="/shared">← Shared codex</Link>
      </p>
      <h1 style={{ marginBottom: 0 }}>{entry.name}</h1>
      <p className="meta">Shared {TYPE_LABELS[entry.type].toLowerCase()}</p>
      <SharedEntryEditor key={entry.id} entry={entry} usedIn={sharedEntryUsage(id)} />
    </>
  );
}
