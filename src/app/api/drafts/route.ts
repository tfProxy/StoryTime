import { hasUnusedDraft } from "@/lib/draftMarks";
import { listDrafts } from "@/lib/draftStore";

export const dynamic = "force-dynamic";

// The drafts list: just enough of each draft to show and open it. `unused`: a posted chapter's draft that differs from it.
export async function GET() {
  return Response.json({ drafts: listDrafts().map((d) => (d.key.startsWith("edit:") && hasUnusedDraft(d.key.slice(5)) ? { ...d, unused: true } : d)) });
}
