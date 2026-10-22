"use client";

import { useState } from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  /** Round to a whole number. */
  integer?: boolean;
  /** Leaving the box empty saves null; otherwise an empty box goes back to the last value. */
  allowEmpty?: boolean;
};

/**
 * A number box that can be cleared or half-typed while editing (on a phone you delete "10" before typing "8").
 * Valid in-range values are saved as they are typed; leaving the box clamps the value and tidies the text.
 */
export default function NumberInput({ value, onChange, min = -Infinity, max = Infinity, integer, allowEmpty, onBlur, ...rest }: Props) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [last, setLast] = useState(shown);
  // The value changed from outside (a reset, another control): show it.
  if (shown !== last) {
    setLast(shown);
    if (text.trim() === "" || Number(text) !== value) setText(shown);
  }

  const parse = (t: string) => {
    if (t.trim() === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? (integer ? Math.round(v) : v) : NaN;
  };

  return (
    <input
      {...rest}
      type="number"
      // iOS's number pads have no minus key, so boxes that allow negatives keep the full keyboard.
      inputMode={min < 0 ? undefined : integer ? "numeric" : "decimal"}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = parse(t);
        if (v === null) {
          if (allowEmpty && value !== null) onChange(null);
        } else if (!Number.isNaN(v) && v >= min && v <= max && v !== value) onChange(v);
      }}
      onBlur={(e) => {
        const v = parse(text);
        if (v === null && allowEmpty) setText("");
        else if (v === null || Number.isNaN(v)) setText(shown);
        else {
          const kept = Math.max(min, Math.min(max, v));
          if (kept !== value) onChange(kept);
          setText(String(kept));
        }
        onBlur?.(e);
      }}
    />
  );
}
