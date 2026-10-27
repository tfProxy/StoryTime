import { handlePost } from "@/lib/api";
import { DecideIssueSchema, decideIssue } from "@/lib/review";

// The author's decision on one Review issue of this chapter: { kind, fingerprint?, status: "later" | "dismissed" | "open" | "intentional", note? }.
// It holds until the chapter is edited; "open" undoes it. "intentional" (continuity only) needs a note and also
// writes it to the codex entry named like the issue's entity, if any ({ codex_entry } is that entry's name or null).
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, DecideIssueSchema, (input) => {
    return { ok: true, ...decideIssue(id, input) };
  }, 200);
}
