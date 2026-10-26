"use client";

import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { normalizeHex } from "@/lib/paint";
import type { RefineTool } from "@/lib/refine/tools";
import { AirbrushIcon, BrushIcon, EraserIcon, EyedropperIcon, HandIcon, EyeIcon, InvertIcon, LassoIcon, MaskBrushIcon, MaskEraserIcon, TrashIcon } from "./RefineIcons";

// The left column's panels. Each is a <section> with a heading, icon buttons on one line, and sliders. To add a
// panel (the next step's Prompt and Results), put another <section className="refine-panel"> in RefineScreen's
// `.refine-tools` column, above the bottom bar.

type ToolButton = { tool: RefineTool; label: string; title: string; icon: () => React.JSX.Element };

function ToolRow({ buttons, active, onTool }: { buttons: ToolButton[]; active: RefineTool; onTool: (t: RefineTool) => void }) {
  return (
    <div className="refine-icons">
      {buttons.map((b) => (
        <button key={b.tool} type="button" className="refine-icon secondary" aria-label={b.label} title={b.title} aria-pressed={active === b.tool} onClick={() => onTool(b.tool)}>
          <b.icon />
        </button>
      ))}
    </div>
  );
}

/** A range with its name and value. `onInput` is called for every movement. */
function Slider({ label, min, max, step = 1, value, shown, onInput, onPointerDown, onBlur }: { label: string; min: number; max: number; step?: number; value: number; shown?: string; onInput: (v: number) => void; onPointerDown?: () => void; onBlur?: () => void }) {
  return (
    <label className="refine-slider">
      <span>{label}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onInput(Number(e.target.value))} onPointerDown={onPointerDown} onBlur={onBlur} />
      <output>{shown ?? value}</output>
    </label>
  );
}

const MASK_BUTTONS: ToolButton[] = [
  { tool: "mask-brush", label: "Mask brush", title: "Paint the area to change", icon: MaskBrushIcon },
  { tool: "mask-eraser", label: "Mask eraser", title: "Take area away from the mask", icon: MaskEraserIcon },
  { tool: "mask-lasso", label: "Lasso", title: "Trace an outline: the inside is added to the mask", icon: LassoIcon },
];

type MaskProps = {
  tool: RefineTool;
  onTool: (t: RefineTool) => void;
  size: number;
  maxSize: number;
  onSize: (v: number) => void;
  /** The committed soft edge, the largest, and how it is changed: `onPreview` for every movement, `onCommit` when it settles (one undo step). */
  softness: number;
  maxSoft: number;
  onSoftPreview: (v: number | null) => void;
  onSoftCommit: (v: number) => void;
  inverted: boolean;
  onInvert: () => void;
  /** There is something to clear, and clearing it (one undo step). */
  canClear: boolean;
  onClear: () => void;
  visible: boolean;
  onToggleVisible: () => void;
  /** Every control is off (a result is being reviewed). */
  disabled?: boolean;
};

export function MaskPanel({ tool, onTool, size, maxSize, onSize, softness, maxSoft, onSoftPreview, onSoftCommit, inverted, onInvert, canClear, onClear, visible, onToggleVisible, disabled = false }: MaskProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);

  function flush() {
    clearTimeout(timer.current);
    const v = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    onSoftPreview(null);
    if (v !== null) onSoftCommit(v);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  function moved(v: number) {
    draftRef.current = v;
    setDraft(v);
    onSoftPreview(v);
    clearTimeout(timer.current);
    // A drag settles when the pointer is let go; a key press or a typed value after a short pause.
    if (!dragging.current) timer.current = setTimeout(flush, 350);
  }

  return (
    <fieldset className="refine-panel" aria-label="Mask" disabled={disabled} data-locked={disabled ? "true" : undefined}>
      <h2>Mask</h2>
      <ToolRow buttons={MASK_BUTTONS} active={tool} onTool={onTool} />
      <Slider label="Mask brush size" min={2} max={maxSize} value={Math.min(size, maxSize)} onInput={onSize} />
      <div className="refine-icons">
        <button type="button" className="refine-icon secondary" aria-label="Invert mask" title="Swap the painted and unpainted areas" aria-pressed={inverted} onClick={onInvert}>
          <InvertIcon />
        </button>
        <button type="button" className="refine-icon secondary" aria-label="Clear mask" title="Take the whole mask away (Undo brings it back)" disabled={!canClear} onClick={onClear}>
          <TrashIcon />
        </button>
        <button type="button" className="refine-icon secondary" aria-label="Show mask" title={visible ? "Hide the mask (a hidden mask is not used)" : "Show the mask"} aria-pressed={visible} onClick={onToggleVisible}>
          <EyeIcon off={!visible} />
        </button>
      </div>
      <Slider
        label="Soft edge"
        min={0}
        max={maxSoft}
        value={Math.min(draft ?? softness, maxSoft)}
        onInput={moved}
        onPointerDown={() => {
          dragging.current = true;
          window.addEventListener(
            "pointerup",
            () => {
              dragging.current = false;
              flush();
            },
            { once: true },
          );
        }}
        onBlur={flush}
      />
    </fieldset>
  );
}

const PAINT_BUTTONS: ToolButton[] = [
  { tool: "pan", label: "Pan", title: "Drag to move the picture (the middle mouse button does this with any tool)", icon: HandIcon },
  { tool: "paint-brush", label: "Paint brush", title: "Paint with the colour", icon: BrushIcon },
  { tool: "airbrush", label: "Airbrush", title: "Soft paint that builds up while you hold", icon: AirbrushIcon },
  { tool: "paint-eraser", label: "Paint eraser", title: "Take paint away (the picture is not touched)", icon: EraserIcon },
  { tool: "eyedropper", label: "Eyedropper", title: "Pick a colour from the picture", icon: EyedropperIcon },
];

type PaintProps = {
  tool: RefineTool;
  onTool: (t: RefineTool) => void;
  size: number;
  maxSize: number;
  onSize: (v: number) => void;
  softness: number;
  onSoftness: (v: number) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  color: string;
  onColor: (hex: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  /** Every control is off (a result is being reviewed). */
  disabled?: boolean;
};

export function PaintPanel({ tool, onTool, size, maxSize, onSize, softness, onSoftness, opacity, onOpacity, color, onColor, visible, onToggleVisible, disabled = false }: PaintProps) {
  // The hex box keeps what is being typed until it is a colour.
  // (`hex` is the colour the text made; once the colour is something else, the box shows the colour again.)
  const [typed, setTyped] = useState<{ text: string; hex: string | null } | null>(null);
  const shown = typed && (typed.hex === null || typed.hex === color) ? typed.text : color;
  return (
    <fieldset className="refine-panel" aria-label="Paint" disabled={disabled} data-locked={disabled ? "true" : undefined}>
      <h2>Paint</h2>
      <ToolRow buttons={PAINT_BUTTONS} active={tool} onTool={onTool} />
      <Slider label="Paint size" min={1} max={maxSize} value={Math.min(size, maxSize)} onInput={onSize} />
      <Slider label="Paint softness" min={0} max={100} value={Math.round(softness * 100)} shown={`${Math.round(softness * 100)}%`} onInput={(v) => onSoftness(v / 100)} />
      <Slider label="Paint opacity" min={5} max={100} value={Math.round(opacity * 100)} shown={`${Math.round(opacity * 100)}%`} onInput={(v) => onOpacity(v / 100)} />
      <div className="refine-colour">
        <HexColorPicker color={color} onChange={(c) => onColor(normalizeHex(c) ?? color)} aria-label="Colour" />
        <div className="refine-colour-row">
          <span className="refine-swatch" style={{ background: color }} title={`Current colour ${color}`} data-color={color} />
          <input
            type="text"
            aria-label="Colour as hex"
            spellCheck={false}
            maxLength={7}
            value={shown}
            onChange={(e) => {
              const hex = normalizeHex(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`);
              setTyped({ text: e.target.value, hex });
              if (hex) onColor(hex);
            }}
            onBlur={() => setTyped(null)}
          />
          <button type="button" className="refine-icon secondary" aria-label="Show paint" title={visible ? "Hide the paint (hidden paint is not used)" : "Show the paint"} aria-pressed={visible} onClick={onToggleVisible}>
            <EyeIcon off={!visible} />
          </button>
        </div>
      </div>
    </fieldset>
  );
}
