import { handlePost } from "@/lib/api";
import { MarkSchema, setPictureMark } from "@/lib/pictureJobs";

export const dynamic = "force-dynamic";

// Pins or rejects one of the job's pictures: { index, mark: "pinned" | "rejected" | null }, where index is
// the picture's place in the job's images and null clears the mark.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, MarkSchema, ({ index, mark }) => setPictureMark(id, index, mark), 200);
}
