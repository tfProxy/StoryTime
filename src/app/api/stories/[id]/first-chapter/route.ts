import { handlePost } from "@/lib/api";
import { queueAutoReview } from "@/lib/autoReview";
import { createFirstChapter, DeskPostSchema, FirstChapterSchema, setOwnSummary } from "@/lib/stories";

// Posts the first chapter of a story that has none yet: { title, body, choices, summary?, path_summary? }.
// 409 when the story already has one. From the writing desk (`rewrite_summary`), the summary is written and the codex
// checked in the background afterwards, as for any other chapter posted there.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePost(request, FirstChapterSchema.and(DeskPostSchema), (input) => {
    const posted = createFirstChapter(id, input);
    if (input.summary_mine && input.summary) setOwnSummary(posted.chapter_id, { mine: true });
    if (input.rewrite_summary) void queueAutoReview(posted.chapter_id, { rewriteSummary: true, summaryModel: input.summary_model });
    return posted;
  });
}
