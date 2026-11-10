import { handlePost } from "@/lib/api";
import { NewRetconSchema, previewRetcon } from "@/lib/retcons";

export const dynamic = "force-dynamic";

// What a retcon would read (its start, the chapters, where it stops), without changing anything.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, NewRetconSchema, (input) => previewRetcon(id, input), 200);
}
