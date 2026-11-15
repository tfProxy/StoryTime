import { handlePost } from "@/lib/api";
import { createCodexOp, NewCodexOpSchema } from "@/lib/codexDb";
import { closeStaleProposals } from "@/lib/codexSuggestions";
import { db } from "@/lib/db";

// Append a codex change (create / replace / retire) anchored at a chapter. An entry added or renamed by hand closes the
// AI's waiting proposals of that entry.
export async function POST(request: Request) {
  return handlePost(request, NewCodexOpSchema, (input) => {
    const made = createCodexOp(input);
    if (input.op !== "retire") {
      const chapter = db().prepare(`SELECT story_id FROM chapters WHERE id = ?`).get(input.anchor_chapter_id) as { story_id: string } | undefined;
      if (chapter) closeStaleProposals(chapter.story_id);
    }
    return made;
  });
}
