import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { fillSummaries, OwnSummarySchema, replaceSummaries, ReplaceSummarySchema, setOwnSummary, SetSummarySchema } from "@/lib/stories";

// Fill in a missing summary for a chapter. Existing summaries are never overwritten here.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SetSummarySchema, (input) => {
    const saved = fillSummaries(id, input);
    void queueAutoReview(id);
    return saved;
  }, 200);
}

// Replace a chapter's summaries. The AI's rewrite after a desk Post or Update (`ai`) is part of a review run already.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ReplaceSummarySchema, (input) => {
    const saved = replaceSummaries(id, input);
    if (!input.ai) void queueAutoReview(id);
    return saved;
  }, 200);
}

// The writing desk's Summary box: the owner's own summary ("yours · not rewritten"), or "Let the AI rewrite it".
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, OwnSummarySchema, (input) => setOwnSummary(id, input), 200);
}
