import Link from "next/link";
import SharedCodexList from "@/components/SharedCodexList";
import { listSharedEntries } from "@/lib/sharedCodex";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared codex" };

export default function SharedCodexPage() {
  return (
    <>
      <p className="crumbs">
        <Link href="/">← Stories</Link>
      </p>
      <h1>Shared codex</h1>
      <p className="meta">
        Characters, places and things you use in more than one story. Add one to a story from that story&apos;s codex page, at the
        chapter where it first appears. Changing it here changes it in every story.
      </p>
      <SharedCodexList entries={listSharedEntries()} />
    </>
  );
}
