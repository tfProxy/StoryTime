import { z } from "zod";
import { handlePost } from "@/lib/api";
import { deleteModelList, getModelList, ModelIdsSchema, setModelList } from "@/lib/modelLists";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// A connection's remembered model list (see modelLists.ts): GET { list: { ids, fetchedAt } | null }, PUT { ids }, DELETE.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return Response.json({ list: getModelList(id) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePost(request, z.object({ ids: ModelIdsSchema }), (input) => ({ list: setModelList(id, input.ids) }), 200);
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  deleteModelList(id);
  return Response.json({ ok: true });
}
