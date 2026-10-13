import type { Metadata } from "next";
import AdminLogin from "@/components/AdminLogin";
import AdminPanel from "@/components/AdminPanel";
import { adminEnabled, isAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { recentActivity, stats } from "../../../scripts/adminCore.mjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · StoryTime", robots: { index: false, follow: false } };

const KINDS = ["chapter", "story", "choice", "codex_op"] as const;
type Kind = (typeof KINDS)[number];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; removed?: string; story?: string; limit?: string }>;
}) {
  if (!adminEnabled()) {
    return (
      <>
        <h1>Admin</h1>
        <p className="notice">
          The admin area is switched off. Set the <code>ADMIN_PASSWORD</code> environment variable and restart the app to
          turn it on. You can also moderate from the command line: <code>node scripts/admin.mjs help</code>.
        </p>
      </>
    );
  }
  if (!(await isAdmin())) {
    return (
      <>
        <h1>Admin</h1>
        <AdminLogin />
      </>
    );
  }

  const q = await searchParams;
  const kind = KINDS.includes(q.kind as Kind) ? (q.kind as Kind) : undefined;
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
  const rows = recentActivity(db(), { limit, kind, storyId: q.story || undefined, removedOnly: q.removed === "1" });

  return (
    <>
      <h1>Admin</h1>
      <AdminPanel
        rows={rows}
        stats={stats(db())}
        filters={{ kind: kind ?? "", removed: q.removed === "1", story: q.story ?? "", limit }}
      />
    </>
  );
}
