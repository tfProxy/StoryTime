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

/** Two sheets, one behind the other: copy to the clipboard. */
export function CopyIcon() {
  return (
    <svg {...svg}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
