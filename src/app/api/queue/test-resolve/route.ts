import { resolveSource } from "@/lib/worker/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// For the API tests only (the test runner starts the server with STORYTIME_TEST=1): the bytes `resolveSource` gives for
// `?source=`, so a test can see each kind of source fetched by the server. Not there otherwise.
export async function GET(request: Request) {
  if (process.env.STORYTIME_TEST !== "1") return Response.json({ error: "Not found" }, { status: 404 });
  const source = new URL(request.url).searchParams.get("source") ?? "";
  try {
    const blob = await resolveSource(source);
    return new Response(await blob.arrayBuffer(), { headers: { "Content-Type": blob.type || "application/octet-stream" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
