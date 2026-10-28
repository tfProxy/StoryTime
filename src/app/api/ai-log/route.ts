import { z } from "zod";
import { db } from "@/lib/db";
import { listAiCalls, listAiSources, recordAiCall } from "@/lib/aiLog";

export const dynamic = "force-dynamic";

// The prompt history: GET lists the newest calls (without their texts) and the labels present, POST stores a call the
// browser made (the server records its own calls itself, from the chat client).

const text = z.string().max(2_000_000);
const optionalId = z.string().max(200).nullish();
const BrowserCall = z.object({
  at: z.number().finite(),
  ms: z.number().finite().min(0),
  source: z.string().max(100).nullish(),
  storyId: optionalId,
  chapterId: optionalId,
  runId: optionalId,
  itemKey: optionalId,
  connection: z.string().max(200).nullish(),
  model: z.string().max(300).nullish(),
  role: z.enum(["main", "cheap"]).nullish(),
  temperature: z.number().finite().nullish(),
  thinkingOff: z.boolean().optional(),
  system: text.nullish(),
  messages: z.array(z.object({ role: z.string().max(40), content: text })).max(200),
  reply: text.nullish(),
  status: z.enum(["ok", "failed", "stopped"]),
  error: text.nullish(),
});

/** A call's texts are cut at 200 KB each when stored; a body much larger than that is refused outright. */
const MAX_BODY = 4_000_000;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_BODY) return Response.json({ error: "That record is too large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "That record is too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = BrowserCall.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return Response.json({ error: message }, { status: 400 });
  }
  const id = recordAiCall(db(), { ...parsed.data, side: "browser" });
  return Response.json({ id }, { status: 201 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const limit = Number(q.get("limit"));
  const d = db();
  return Response.json({
    calls: listAiCalls(d, {
      source: q.get("source") || undefined,
      storyId: q.get("story") || undefined,
      chapterId: q.get("chapter") || undefined,
      runId: q.get("run") || undefined,
      failedOnly: q.get("failed") === "1",
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }),
    sources: listAiSources(d),
  });
}
