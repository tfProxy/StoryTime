import { handlePost } from "@/lib/api";
import { renameForm, RenameFormSchema } from "@/lib/codexDb";

// Rename one of an entry's forms everywhere in the story (a correction: every chapter and branch reads the new name).
export async function POST(request: Request) {
  return handlePost(request, RenameFormSchema, renameForm);
}
