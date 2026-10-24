// Small line icons for the Refine screen's tools, drawn in the text colour. Each is hidden from screen readers:
// the button around it carries the name.

const svg = { width: "1.3em", height: "1.3em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

/** A paint brush. */
export function BrushIcon() {
  return (
    <svg {...svg}>
      <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8l-3-3Z" />
      <path d="M7 14c-2.5 0-4 1.6-4 4 0 1.5-.5 2.5-1.5 3 3.5.5 8-.5 8-4.5Z" />
    </svg>
  );
}

/** A spray can: soft paint that builds up. */
export function AirbrushIcon() {
  return (
    <svg {...svg}>
      <rect x="4" y="11" width="8" height="11" rx="1.5" />
      <path d="M6 11V8h4v3" />
      <path d="M8 8V5" />
      <circle cx="15.5" cy="5" r=".6" fill="currentColor" />
      <circle cx="18.5" cy="3.5" r=".6" fill="currentColor" />
      <circle cx="18.5" cy="7" r=".6" fill="currentColor" />
      <circle cx="21" cy="5.2" r=".6" fill="currentColor" />
      <circle cx="12.5" cy="3.5" r=".6" fill="currentColor" />
    </svg>
  );
}

/** An eraser. */
export function EraserIcon() {
  return (
    <svg {...svg}>
      <path d="M20 20H9l-5.3-5.3a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l5.6 5.6a1.5 1.5 0 0 1 0 2.1L12 20" />
      <path d="M7.5 9.5l7 7" />
    </svg>
  );
}

/** A pipette. */
export function EyedropperIcon() {
  return (
    <svg {...svg}>
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2 2 0 1 1 3 3L18 9l.4.4a2 2 0 1 1-3 3l-3.8-3.8a2 2 0 1 1 3-3Z" />
    </svg>
  );
}

/** A dashed shape with a brush dot: paint the mask. */
export function MaskBrushIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
}

/** A dashed shape with a bar: take away from the mask. */
export function MaskEraserIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <path d="M7.5 12h9" />
    </svg>
  );
}

/** A loop and its tail: trace an outline. */
export function LassoIcon() {
  return (
    <svg {...svg}>
      <ellipse cx="11" cy="9" rx="8" ry="5.5" strokeDasharray="3 2.5" />
      <path d="M5 13.5c-1 2.5 0 4 2 4s2-2.5 2-2.5" />
      <circle cx="9" cy="19" r="1.7" />
    </svg>
  );
}

/** Two halves swapped: invert the mask. */
export function InvertIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
    </svg>
  );
}

/** An eye, struck through when `off`. */
export function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg {...svg}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg {...svg}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg {...svg}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}
