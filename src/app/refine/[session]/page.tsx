"use client";

import { use } from "react";
import RefineScreen from "@/components/RefineScreen";

// The Refine screen for one session (kept in this browser, see src/lib/refine/session.ts). `params` is a Promise in Next 16.
export default function RefinePage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = use(params);
  return <RefineScreen sessionId={session} />;
}
