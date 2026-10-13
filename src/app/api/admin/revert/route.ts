import { z } from "zod";
import { requireAdminJson } from "@/lib/adminApi";
import { db } from "@/lib/db";
import { AdminError, revertChapter } from "../../../../../scripts/adminCore.mjs";

const Body = z.object({ chapter_id: z.string().min(1).max(64), revision: z.number().int().min(1) });

export async function POST(request: Request) {
  const denied = await requireAdminJson(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(revertChapter(db(), parsed.data.chapter_id, parsed.data.revision));
  } catch (e) {
    if (e instanceof AdminError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
