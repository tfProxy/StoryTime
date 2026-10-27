import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { fillSummaries, replaceSummaries, ReplaceSummarySchema, SetSummarySchema } from "@/lib/stories";

// Fill in a missing summary for a chapter. Existing summaries are never overwritten here.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SetSummarySchema, (input) => {
    const saved = fillSummaries(id, input);
    void queueAutoReview(id);
    return saved;
  }, 200);
}

// Replace a chapter's summaries.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ReplaceSummarySchema, (input) => {
    const saved = replaceSummaries(id, input);
    void queueAutoReview(id);
    return saved;
  }, 200);
}
