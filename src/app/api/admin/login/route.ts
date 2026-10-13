import { z } from "zod";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  adminEnabled,
  clearLoginFailures,
  loginLockedOut,
  makeSessionValue,
  passwordMatches,
  recordLoginFailure,
  sessionMaxAgeSeconds,
} from "@/lib/adminAuth";

const Body = z.object({ password: z.string().max(500) });

export async function POST(request: Request) {
  if (!adminEnabled()) {
    return Response.json({ error: "The admin area is switched off. Set the ADMIN_PASSWORD environment variable." }, { status: 503 });
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "Expected a JSON request" }, { status: 415 });
  }
  if (loginLockedOut()) {
    return Response.json({ error: "Too many failed attempts. Wait a few minutes and try again." }, { status: 429 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the password" }, { status: 400 });

  if (!passwordMatches(parsed.data.password)) {
    recordLoginFailure();
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  clearLoginFailures();
  const https = (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";
  (await cookies()).set(ADMIN_COOKIE, makeSessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: https,
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return Response.json({ ok: true });
}
