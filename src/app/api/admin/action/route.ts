import { z } from "zod";
import { requireAdminJson } from "@/lib/adminApi";
import { db } from "@/lib/db";
import { AdminError, hardDelete, remove, restore } from "../../../../../scripts/adminCore.mjs";

const Body = z.object({
  action: z.enum(["remove", "restore", "delete"]),
  kind: z.enum(["chapter", "story", "codex_op", "choice"]),
  id: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  const denied = await requireAdminJson(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { action, kind, id } = parsed.data;
  try {
    if (action === "remove") return Response.json(remove(db(), kind, id));
    if (action === "restore") return Response.json(restore(db(), kind, id));
    if (kind !== "chapter" && kind !== "story") {
      return Response.json({ error: "Only chapters and stories can be deleted permanently" }, { status: 400 });
    }
    return Response.json(hardDelete(db(), kind, id));
  } catch (e) {
    if (e instanceof AdminError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
