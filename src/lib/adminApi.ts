import { isAdmin } from "./adminAuth";

/** Shared guard for admin API routes: admin session + a JSON body (blocks cross-site form posts). */
export async function requireAdminJson(request: Request): Promise<Response | null> {
  if (!(await isAdmin())) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "Expected a JSON request" }, { status: 415 });
  }
  return null;
}
