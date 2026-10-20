import { z } from "zod";
import { handlePost } from "@/lib/api";
import { moveDraft } from "@/lib/draftStore";
import { createStory, listStories, NewStorySchema } from "@/lib/stories";

export async function GET() {
  return Response.json(listStories());
}

const CreateSchema = NewStorySchema.extend({
  /** Keep the draft started on the old New story page (key "story") as this story's first-chapter draft. */
  adopt_draft: z.boolean().optional(),
});

// A new story: { title, premise, style }, with `chapter` to post its first chapter at once.
export async function POST(request: Request) {
  return handlePost(request, CreateSchema, ({ adopt_draft, ...input }) => {
    const made = createStory(input);
    if (adopt_draft && made.chapter_id === null) {
      moveDraft("story", `first:${made.story_id}`, { href: `/s/${made.story_id}/write`, label: `${input.title}: first chapter` });
    }
    return made;
  });
}
