import { listDrafts } from "@/lib/draftStore";

export const dynamic = "force-dynamic";

// The drafts list: just enough of each draft to show and open it.
export async function GET() {
  return Response.json({ drafts: listDrafts() });
}
