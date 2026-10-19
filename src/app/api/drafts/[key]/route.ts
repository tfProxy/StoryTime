import { deleteDraft, getDraft, MAX_DRAFT_CHARS, putDraft } from "@/lib/draftStore";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

const MAX_KEY = 200;

export async function GET(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const draft = getDraft(key);
  if (!draft) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ draft });
}

/**
 * Body: `{ draft, base }`, where `base` is the `updatedAt` the browser loaded (null for a new
 * draft). If someone saved in between, the answer is 409 with the stored draft as `current`.
 * `{ draft, imported: true }` moves a draft over from browser storage, keeping its own time,
 * unless the stored one is newer.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  if (!key || key.length > MAX_KEY) return Response.json({ error: "Bad draft key" }, { status: 400 });
  const text = await request.text();
  if (text.length > MAX_DRAFT_CHARS) return Response.json({ error: "This draft is too big to save" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const body = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const draft = body?.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return Response.json({ error: "Body must have a draft object" }, { status: 400 });
  }
  const d = draft as Record<string, unknown>;
  if (typeof d.href !== "string" || typeof d.label !== "string") {
    return Response.json({ error: "A draft needs an href and a label" }, { status: 400 });
  }
  let result;
  if (body.imported === true) {
    const at = typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? Math.floor(d.updatedAt) : Date.now();
    result = putDraft(key, d, { importedAt: at });
    // An older copy than the stored one isn't an error: the stored one simply wins.
    return Response.json(result.ok ? { updatedAt: result.updatedAt } : { updatedAt: result.current.updatedAt, kept: true });
  }
  const base = body.base;
  if (base !== null && !(typeof base === "number" && Number.isFinite(base))) {
    return Response.json({ error: "base must be a number or null" }, { status: 400 });
  }
  result = putDraft(key, d, { base });
  if (!result.ok) {
    return Response.json(
      { error: "This draft was changed in another tab or browser", current: Object.keys(result.current).length ? result.current : null },
      { status: 409 },
    );
  }
  return Response.json({ updatedAt: result.updatedAt });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  deleteDraft(key);
  return Response.json({ ok: true });
}
