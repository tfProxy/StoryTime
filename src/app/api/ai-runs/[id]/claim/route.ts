import { handlePost } from "@/lib/api";
import { claimRun, ClaimSchema } from "@/lib/aiRuns";

// Takes the run for this tab (a lease of two minutes, renewed by each save); 409 when another tab has it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ClaimSchema, (input) => claimRun(id, input), 200);
}
