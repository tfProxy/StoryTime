import { instanceId } from "@/lib/instance";

export const dynamic = "force-dynamic";

// This StoryTime's own id, which the picture queue puts in the jobs it queues in ComfyUI.
export async function GET() {
  return Response.json({ id: instanceId() });
}
