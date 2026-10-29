"use client";

import { useEffect } from "react";
import { setChatRecorder, type ChatRecord } from "@/lib/ai/client";

// Sends every text AI call this browser makes to the prompt history (/ai-log). Rendered once in the layout, so it is
// always mounted. It registers in an effect, which never runs on the server: the server has its own recorder on
// globalThis (see aiLog.ts), and this one must not replace it. Fire and forget; a failure never touches the call.
const marker = "__storytimeBrowserRecorder";

function send(record: ChatRecord) {
  const { source, ...rest } = record;
  const body = JSON.stringify({
    ...rest,
    source: source?.label,
    storyId: source?.storyId,
    chapterId: source?.chapterId,
    runId: source?.runId,
    itemKey: source?.itemKey,
  });
  // keepalive lets the record leave even if the page is closing; it is limited to 64 KB, so a bigger one goes without.
  void fetch("/api/ai-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: body.length < 60_000,
  }).catch(() => {});
}

export default function AiLogRecorder() {
  useEffect(() => {
    const w = window as unknown as Record<string, boolean | undefined>;
    if (w[marker]) return;
    w[marker] = true;
    setChatRecorder(send);
  }, []);
  return null;
}
