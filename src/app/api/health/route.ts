import { db } from "@/lib/db";

// Used by the Docker health check: confirms the app is up and the database opens.
export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
