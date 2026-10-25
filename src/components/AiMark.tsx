import type { AiMark as Mark } from "@/lib/stories";

// A small robot line icon (same 24 box, round strokes and currentColor as PictureIcons). Unreviewed AI chapters
// get a filled head in the accent colour; reviewed ones a quiet outline in the muted colour. Nothing for the owner's own.
export default function AiMark({ mark }: { mark: Mark }) {
  if (mark === null) return null;
  const unreviewed = mark === "unreviewed";
  const title = unreviewed ? "Written by AI, not reviewed" : "Written by AI";
  return (
    <svg
      className={`ai-mark ${unreviewed ? "ai-mark-unreviewed" : "ai-mark-reviewed"}`}
      width="1.25em"
      height="1.25em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title}
      focusable={false}
    >
      <title>{title}</title>
      <path d="M12 3v3" />
      <circle cx="12" cy="2.5" r="0.6" />
      <rect x="4" y="6" width="16" height="13" rx="3" fill={unreviewed ? "currentColor" : "none"} />
      <path d="M2 11.5v3M22 11.5v3" />
      <circle cx="9" cy="12" r="1.3" fill={unreviewed ? "var(--card, #fff)" : "currentColor"} stroke="none" />
      <circle cx="15" cy="12" r="1.3" fill={unreviewed ? "var(--card, #fff)" : "currentColor"} stroke="none" />
      <path d="M9 16h6" stroke={unreviewed ? "var(--card, #fff)" : "currentColor"} />
    </svg>
  );
}
