"use client";

import { useState } from "react";
import { FACT_LIMITS, isFormAspect, sameAspect, type EntryType } from "@/lib/codex";
import { categoryOf } from "@/lib/codexCategories";
import { useSettings } from "@/lib/settings";

const OTHER = "\u0000other";

/**
 * The aspect of a fact, picked from the shared category list for the entry's type (Settings → Codex), with the
 * entry's own aspects that aren't on it and "Other…" for a new one. "" is a loose fact with no aspect.
 */
export function AspectPicker({
  type,
  value,
  onChange,
  have,
}: {
  type: EntryType;
  value: string;
  onChange: (aspect: string) => void;
  /** The entry's facts, so aspects it already uses are offered too. */
  have: { aspect: string }[];
}) {
  const list = useSettings().codexCategories[type];
  const own: string[] = [];
  for (const f of have) {
    const a = f.aspect.trim();
    if (a && !isFormAspect(a) && !list.some((x) => sameAspect(x.name, a)) && !own.some((o) => sameAspect(o, a))) own.push(a);
  }
  const offered = (a: string) => !a.trim() || list.some((x) => sameAspect(x.name, a)) || own.some((o) => sameAspect(o, a));
  const [other, setOther] = useState(!offered(value));
  const selected = other ? OTHER : (list.find((x) => sameAspect(x.name, value))?.name ?? own.find((o) => sameAspect(o, value)) ?? "");
  const groups: { group: string; names: string[] }[] = [];
  for (const x of list) {
    const last = groups[groups.length - 1];
    if (last && last.group === x.group) last.names.push(x.name);
    else groups.push({ group: x.group, names: [x.name] });
  }
  // A typed name that is another name for a category on the list ("Fur" for Skin) is filed under it.
  const filed = other && value.trim() ? categoryOf(value, list) : null;

  return (
    <span className="aspect-picker">
      <select
        aria-label="Aspect"
        value={selected}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">No category (a loose fact)</option>
        {groups.map((g, i) =>
          g.group ? (
            <optgroup key={`${g.group}-${i}`} label={g.group}>
              {g.names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          ) : (
            g.names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))
          ),
        )}
        {own.length > 0 && (
          <optgroup label="On this entry, not on the list">
            {own.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </optgroup>
        )}
        <option value={OTHER}>Other…</option>
      </select>
      {other && (
        <input aria-label="New aspect" placeholder="Name of the new category" value={value} maxLength={FACT_LIMITS.aspect} onChange={(e) => onChange(e.target.value)} autoFocus />
      )}
      {filed && !sameAspect(filed.name, value) && (
        <small>
          “{value.trim()}” is filed under {filed.name} on your list.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOther(false);
              onChange(filed.name);
            }}
          >
            Use {filed.name}
          </button>
        </small>
      )}
    </span>
  );
}
