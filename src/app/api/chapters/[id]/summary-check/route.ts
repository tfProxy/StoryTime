import { handlePost } from "@/lib/api";
import { SaveSummaryCheckSchema, saveSummaryCheck } from "@/lib/summaryChecks";

// Save the AI's check of a chapter's summary (replacing the earlier one). 409 when the chapter or its summary was edited meanwhile.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, SaveSummaryCheckSchema, (input) => saveSummaryCheck(id, input), 200);
}
