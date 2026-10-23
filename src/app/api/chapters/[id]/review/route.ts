import { handlePost } from "@/lib/api";
import { DecideIssueSchema, decideIssue } from "@/lib/review";

// The author's decision on one Review issue of this chapter: { kind, fingerprint?, status: "later" | "dismissed" | "open" }.
// It holds until the chapter is edited; "open" undoes it.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, DecideIssueSchema, (input) => {
    decideIssue(id, input);
    return { ok: true };
  }, 200);
}
