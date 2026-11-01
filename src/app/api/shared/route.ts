import { handlePost } from "@/lib/api";
import { createSharedEntry, listSharedEntries, NewSharedEntrySchema } from "@/lib/sharedCodex";

export const dynamic = "force-dynamic";

// Every shared codex entry.
export async function GET() {
  return Response.json({ entries: listSharedEntries() });
}

// Add a shared entry.
export async function POST(request: Request) {
  return handlePost(request, NewSharedEntrySchema, createSharedEntry);
}
