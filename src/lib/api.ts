import { z } from "zod";
import { PostError } from "./stories";

/** Parse a JSON body with a zod schema and run the handler, mapping errors to JSON responses. */
export async function handlePost<S extends z.ZodType>(
  request: Request,
  schema: S,
  run: (input: z.infer<S>) => unknown,
  status = 201,
): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return Response.json({ error: message }, { status: 400 });
  }
  try {
    return Response.json(run(parsed.data), { status });
  } catch (e) {
    if (e instanceof PostError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
