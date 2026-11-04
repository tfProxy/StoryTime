import Link from "next/link";
import MoreMenu from "@/components/MoreMenu";

const icon = { className: "action-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

// The chapter's actions under its title: the common ones as quiet buttons, the rest in a "⋯" menu.
// A chapter in the trash can't be edited or written ahead of.
export default function ChapterActions({
  chapterId,
  storyId,
  trashed,
  summaryDone,
}: {
  chapterId: string;
  storyId: string;
  trashed: boolean;
  summaryDone: boolean;
}) {
  return (
    <div className="chapter-actions">
      {!trashed && (
        <Link href={`/c/${chapterId}/edit`}>
          <svg {...icon}>
            <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z M14.5 6.5l3 3" />
          </svg>
          Edit
        </Link>
      )}
      <Link href={`/c/${chapterId}/illustrate`}>
        <svg {...icon}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M3 17l5-4 4 3 3-2 6 4" />
        </svg>
        Illustrate
      </Link>
      <Link href={`/s/${storyId}/review?tab=codex&chapter=${chapterId}`}>
        <svg {...icon}>
          <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11" />
        </svg>
        Codex
      </Link>
      {!trashed && (
        <Link href={`/c/${chapterId}/write-ahead`}>
          <svg {...icon}>
            <path d="M5 12h14 M13 6l6 6-6 6" />
          </svg>
          Write ahead
        </Link>
      )}
      <MoreMenu label="More chapter actions">
        <Link href={`/c/${chapterId}/history`}>History</Link>
        <Link href={`/c/${chapterId}/path`}>Read this path</Link>
        <Link href={`/s/${storyId}/outline#c-${chapterId}`}>Open in outline</Link>
        <Link href={`/c/${chapterId}/summary`}>{summaryDone ? "Summary" : "Summary (missing)"}</Link>
        <Link href={`/s/${storyId}/pictures?from=${chapterId}`}>Make missing pictures…</Link>
      </MoreMenu>
    </div>
  );
}
