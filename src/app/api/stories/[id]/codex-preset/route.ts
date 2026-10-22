import { handlePost } from "@/lib/api";
import { CodexPresetSchema, getCodexPreset, setCodexPreset } from "@/lib/codexPictures";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const entryOf = (request: Request) => new URL(request.url).searchParams.get("entry");

// The drawing preset a codex entry's pictures use (?entry=<entry id>): { draw_preset } (an id from Settings), or null to use the story's.
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const entry = entryOf(request);
  if (!entry) return Response.json({ error: "Give the entry" }, { status: 400 });
  return Response.json({ draw_preset: getCodexPreset(id, entry) });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const entry = entryOf(request);
  if (!entry) return Response.json({ error: "Give the entry" }, { status: 400 });
  return handlePost(request, CodexPresetSchema, (input) => setCodexPreset(id, entry, input), 200);
}
