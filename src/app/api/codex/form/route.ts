import { handlePost } from "@/lib/api";
import { changeForm, FormChangeSchema } from "@/lib/codexDb";

// Change an entry's form and sort its facts between the old and new forms, in one go.
export async function POST(request: Request) {
  return handlePost(request, FormChangeSchema, changeForm);
}
