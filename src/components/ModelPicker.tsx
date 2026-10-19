"use client";

import Link from "next/link";
import { providerInfo } from "@/lib/ai/providers";
import {
  defaultRef,
  findConnection,
  modelLabel,
  parseRefKey,
  refKey,
  saveSettings,
  sameRef,
  useSettings,
  type ModelRef,
} from "@/lib/settings";

/**
 * Picks the model for one kind of job on this page, from the favorites starred in Settings.
 * `value` null means "use the default from Settings".
 */
export default function ModelPicker({
  value,
  role,
  label,
  onChange,
}: {
  value: ModelRef | null;
  role: "main" | "cheap";
  /** Accessible name, like "Model for writing". */
  label: string;
  onChange: (ref: ModelRef | null) => void;
}) {
  const settings = useSettings();
  const def = defaultRef(settings, role);
  const groups = settings.connections
    .map((c) => ({ c, favs: settings.favorites.filter((f) => f.connectionId === c.id) }))
    .filter((g) => g.favs.length > 0);
  const starred = value ? settings.favorites.some((f) => sameRef(f, value)) : true;
  const favName = (m: string, l: string) => l.trim() || m;

  function makeDefault() {
    if (!value) return;
    void saveSettings({ ...settings, defaults: { ...settings.defaults, [role]: value } });
    onChange(null);
  }

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
      {value && findConnection(settings, value.connectionId) && !sameRef(value, def) && (
        <button type="button" className="secondary" onClick={makeDefault} title="Use this model by default for new drafts">
          Make default
        </button>
      )}
      {groups.length === 0 && (
        <Link href="/settings#models" className="meta">
          Star models
        </Link>
      )}
    </span>
  );
}
