import { z } from "zod";
import { handlePost } from "@/lib/api";
import { newId } from "@/lib/db";
import { putDraft } from "@/lib/draftStore";
import { PostError } from "@/lib/stories";
import { IMPORT_LIMITS, importOptionsSchema, newImportDraft, parseStoryText } from "@/lib/textImport";
import { getWorker } from "@/lib/worker";
import { startImport } from "@/lib/worker/importText";

export const dynamic = "force-dynamic";

const StartSchema = z.object({
  text: z.string().max(IMPORT_LIMITS.text, `The story is too long to import (at most ${IMPORT_LIMITS.text.toLocaleString("en")} characters)`),
  options: importOptionsSchema,
});

// Starts importing a story from text: the text is cut into paragraphs and kept in a draft (`import:<id>`), and the
// server's queue finds the chapter breaks. The review page (`href`) shows the result.
export async function POST(request: Request) {
  return handlePost(request, StartSchema, ({ text, options }) => {
    const parsed = parseStoryText(text);
    if (parsed.paragraphs.length === 0) throw new PostError("There is no story text to import", 400);
    if (parsed.paragraphs.length > IMPORT_LIMITS.paragraphs) throw new PostError(`The story has too many paragraphs to import (at most ${IMPORT_LIMITS.paragraphs})`, 400);
    const draft = newImportDraft(newId(), parsed, options);
    putDraft(draft.key, draft as unknown as Record<string, unknown>, { base: null });
    getWorker();
    startImport(draft);
    return { key: draft.key, href: draft.href };
  });
}
