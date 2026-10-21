"use client";

import Link from "next/link";
import { providerInfo } from "@/lib/ai/providers";
import {
  defaultRef,
  favoritesFor,
  modelLabel,
  parseRefKey,
  refKey,
  sameRef,
  useSettings,
  type ModelRef,
  type ModelUse,
} from "@/lib/settings";

/**
 * Picks the model for one kind of job on this page, from the favorites starred in Settings that are
 * offered for that job. `value` null means "use the default from Settings".
 */
export default function ModelPicker({
  value,
  role,
  use,
  label,
  onChange,
}: {
  value: ModelRef | null;
  role: "main" | "cheap";
  /** The job, which decides the starred models offered (each can opt out of jobs in Settings). */
  use: ModelUse;
  /** Accessible name, like "Model for writing". */
  label: string;
  onChange: (ref: ModelRef | null) => void;
}) {
  const settings = useSettings();
  const def = defaultRef(settings, role);
  const offered = favoritesFor(settings, use);
  const groups = settings.connections
    .map((c) => ({ c, favs: offered.filter((f) => f.connectionId === c.id) }))
    .filter((g) => g.favs.length > 0);
  // A model picked earlier and since unstarred or opted out of this job stays shown while it is picked.
  const starred = value ? offered.some((f) => sameRef(f, value)) : true;
  const favName = (m: string, l: string) => l.trim() || m;

  return (
    <span className="row model-picker" style={{ gap: "0.4rem" }}>
      <select
        aria-label={label}
        title={label}
        style={{ width: "auto", maxWidth: "min(16rem, 100%)" }}
        value={value ? refKey(value) : ""}
        onChange={(e) => onChange(e.target.value ? parseRefKey(e.target.value) : null)}
      >
        <option value="">{def ? `Default: ${modelLabel(settings, def)}` : "Default (none set)"}</option>
        {value && !starred && <option value={refKey(value)}>{modelLabel(settings, value)}</option>}
        {groups.length === 1
          ? groups[0].favs.map((f) => (
              <option key={refKey(f)} value={refKey(f)}>
                {favName(f.model, f.label)}
              </option>
            ))
          : groups.map(({ c, favs }) => (
              <optgroup key={c.id} label={c.name || providerInfo(c.kind).label}>
                {favs.map((f) => (
                  <option key={refKey(f)} value={refKey(f)}>
                    {favName(f.model, f.label)}
                  </option>
                ))}
              </optgroup>
            ))}
      </select>
      {groups.length === 0 && (
        <Link href="/settings#models" className="meta">
          {settings.favorites.length === 0 ? "Star models" : "No starred model is offered for this"}
        </Link>
      )}
    </span>
  );
}
