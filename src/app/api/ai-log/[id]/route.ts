import { db } from "@/lib/db";
import { getAiCall } from "@/lib/aiLog";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const call = getAiCall(db(), id);
  if (!call) return Response.json({ error: "That call is no longer in the history" }, { status: 404 });
  return Response.json({ call });
}
