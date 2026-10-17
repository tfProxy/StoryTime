import { getSettings, putSettings } from "@/lib/settingsStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ settings: getSettings() });
}

export async function PUT(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return Response.json({ error: "Body must be a settings object" }, { status: 400 });
  }
  return Response.json({ settings: putSettings(json) });
}
