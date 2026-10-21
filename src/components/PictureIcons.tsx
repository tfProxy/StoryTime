// Small line icons for the picture buttons, drawn in the text colour. Each is hidden from screen readers:
// the button around it carries the name.

type IconProps = { filled?: boolean };

const svg = { width: "1.25em", height: "1.25em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

/** A thumbtack, filled when the picture is pinned. */
export function PinIcon({ filled = false }: IconProps) {
  return (
    <svg {...svg}>
      <path d="M12 17v5" />
      <path
        d="M9 10.76V6H8a2 2 0 0 1 0-4h8a2 2 0 0 1 0 4h-1v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76Z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

/** A trash can: move the picture to Trashed. */
export function TrashIcon() {
  return (
    <svg {...svg}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** A page with its top band filled: the header picture. */
export function HeaderIcon() {
  return (
    <svg {...svg} strokeWidth={1.6}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 8.5h16V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2Z" fill="currentColor" />
      <path d="M8 13h8M8 17h8" />
    </svg>
  );
}

/** A page with its bottom band filled: the footer picture. */
export function FooterIcon() {
  return (
    <svg {...svg} strokeWidth={1.6}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 15.5h16V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" fill="currentColor" />
      <path d="M8 7h8M8 11h8" />
    </svg>
  );
}

/** A pencil: the picture is being edited or redrawn. */
export function PencilIcon() {
  return (
    <svg {...svg}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** A paintbrush: go and make pictures for the chapter. */
export function BrushIcon() {
  return (
    <svg {...svg}>
      <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
      <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
      <path d="M14.5 17.5 4.5 15" />
    </svg>
  );
}

/** Two sheets, one behind the other: copy to the clipboard. */
export function CopyIcon() {
  return (
    <svg {...svg}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** A gear: change something in Settings. */
export function SettingsIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

/** A sparkle: let the AI write something. */
export function SparkleIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
      <path d="M19 15v4M17 17h4" />
    </svg>
  );
}

/** A circular arrow: do it again. */
export function RedoIcon() {
  return (
    <svg {...svg}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

/** Three lines: a menu of more actions. */
export function MenuIcon() {
  return (
    <svg {...svg}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
