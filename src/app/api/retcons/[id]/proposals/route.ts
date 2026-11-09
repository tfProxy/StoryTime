import { handlePost } from "@/lib/api";
import { ProposalSchema, saveProposal } from "@/lib/retcons";

export const dynamic = "force-dynamic";

// The run saves what the AI proposes for one chapter: { saved }. 409 when the chapter was edited since it was read.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, ProposalSchema, (input) => saveProposal(id, input), 200);
}
