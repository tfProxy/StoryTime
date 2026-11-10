import { z } from "zod";
import { db } from "@/lib/db";
import { listAiCalls, listAiSources, recordAiCall } from "@/lib/aiLog";
import { KeptDetailsSchema, keepRequest } from "@/lib/keptRequests";
import type { ChatMessage } from "@/lib/ai/client";
import type { ProviderKind } from "@/lib/ai/providers";
import type { AiJob } from "@/lib/settingsSchema";

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
  /** A call that wrote chapter text, to keep for good as well (see keptRequests.ts). */
  keep: KeptDetailsSchema.optional(),
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
  const call = parsed.data;
  if (call.keep) {
    keepRequest(
      db(),
      {
        at: call.at,
        ms: call.ms,
        source: call.source ? { label: call.source, storyId: call.storyId ?? undefined, chapterId: call.chapterId ?? undefined, runId: call.runId ?? undefined } : undefined,
        system: call.system ?? undefined,
        messages: call.messages as ChatMessage[],
        connection: call.connection ?? null,
        model: call.model ?? null,
        role: call.role ?? null,
        temperature: call.temperature ?? null,
        thinkingOff: !!call.thinkingOff,
        reply: call.reply ?? "",
        status: call.status,
        error: call.error ?? undefined,
        keep: { ...call.keep, kind: call.keep.kind as ProviderKind | null, job: call.keep.job as AiJob | null },
      },
      "browser",
    );
  }
  const { keep: _keep, ...logged } = call;
  void _keep;
  const id = recordAiCall(db(), { ...logged, side: "browser" });
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
      itemKey: q.get("item") || undefined,
      failedOnly: q.get("failed") === "1",
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }),
    sources: listAiSources(d),
  });
}
