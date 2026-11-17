"use client";

import { providerInfo } from "@/lib/ai/providers";
import {
  favoriteFor,
  favoritesFor,
  findConnection,
  jobRef,
  MODEL_USES,
  modelLabel,
  ownJobRef,
  parseRefKey,
  refKey,
  sameRef,
  withJobDefault,
  type Favorite,
  type ModelRef,
  type ModelUse,
  type Settings,
} from "@/lib/settings";
import type { ThinkingOff } from "@/lib/settingsSchema";
import NumberInput from "./NumberInput";

// A starred model's thinking choices. Thinking for everything but writing makes little sense, so it is only shown
// when settings from elsewhere have it.
const THINKING_OPTIONS: { off: ThinkingOff; label: string; onlyIfSet?: boolean }[] = [
  { off: { write: false, other: false }, label: "Think for everything" },
  { off: { write: false, other: true }, label: "Only when writing chapters" },
  { off: { write: true, other: true }, label: "Never think" },
  { off: { write: true, other: false }, label: "Everything but writing", onlyIfSet: true },
];
const thinkingKey = (off: ThinkingOff) => `${off.write ? "w" : ""}${off.other ? "o" : ""}` || "none";

/**
 * One job's default: the models offered for it, or, for every job but Writing, falling back to another job's default
 * (Summaries to Writing, the rest to Summaries), named with the model that gives.
 */
function JobDefault({ settings, use, onChange }: { settings: Settings; use: ModelUse; onChange: (ref: ModelRef | null) => void }) {
  const value = ownJobRef(settings, use);
  const offered = favoritesFor(settings, use);
  const from = use === "summaries" ? "write" : "summaries";
  const fallback = jobRef(settings, from);
  const blank =
    use === "write"
      ? "Choose a model…"
      : `Same as ${MODEL_USES.find((u) => u.id === from)!.label}${fallback ? ` (${modelLabel(settings, fallback)})` : ""}`;
  // Still the default, but no longer in use or offered for this job: say so rather than hide it.
  const listed = !value || offered.some((f) => sameRef(f, value));
  const why = value && favoriteFor(settings, value) ? " (not offered for this)" : " (not in use)";
  return (
    <select value={value ? refKey(value) : ""} onChange={(e) => onChange(e.target.value ? parseRefKey(e.target.value) : null)}>
      <option value="">{blank}</option>
      {value && !listed && <option value={refKey(value)}>{modelLabel(settings, value) + why}</option>}
      {offered.map((f) => (
        <option key={refKey(f)} value={refKey(f)}>
          {modelLabel(settings, f)}
        </option>
      ))}
    </select>
  );
}

/**
 * Settings › Writing: one row per model in use, with its own settings (nickname, context, thinking) and, for each job,
 * whether that job's pickers offer the model; then each job's default. On a phone each row is a card.
 */
export default function ModelGrid({
  settings,
  onSave,
  onFavorite,
  onRemove,
}: {
  settings: Settings;
  onSave: (next: Settings) => void;
  onFavorite: (fav: Favorite, patch: Partial<Favorite>) => void;
  onRemove: (fav: Favorite) => void;
}) {
  // In the Connections tab's order; a model whose connection is gone comes last.
  const order = new Map(settings.connections.map((c, i) => [c.id, i]));
  const favs = [...settings.favorites].sort((a, b) => (order.get(a.connectionId) ?? Infinity) - (order.get(b.connectionId) ?? Infinity));
  const offered = (f: Favorite, u: ModelUse) => !f.hiddenFrom.includes(u);
  const setOffered = (f: Favorite, u: ModelUse, on: boolean) =>
    onFavorite(f, { hiddenFrom: on ? f.hiddenFrom.filter((x) => x !== u) : [...f.hiddenFrom, u] });

  return (
    <>
      <p className="meta">
        A ticked box offers the model in that job&apos;s pickers; each job&apos;s default is chosen below the grid. Pages with
        their own model picker (the writing page, Write ahead, Illustrate) can still choose another. A blank Context uses
        the Context budget under Options.
      </p>
      <div className="model-grid-wrap">
        <table className="model-grid">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Context</th>
              <th scope="col">Thinking</th>
              {MODEL_USES.map((u) => (
                <th key={u.id} scope="col" className="job" title={u.hint}>
                  {u.label}
                </th>
              ))}
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {favs.map((f) => {
              const conn = findConnection(settings, f.connectionId);
              const name = f.label.trim() || f.model;
              return (
                <tr key={refKey(f)} aria-label={name}>
                  <th scope="row" className="model-name">
                    <input
                      aria-label={`Nickname for ${f.model}`}
                      placeholder={f.model}
                      value={f.label}
                      onChange={(e) => onFavorite(f, { label: e.target.value })}
                    />
                    <span className="meta">
                      {f.label.trim() ? `${f.model} · ` : ""}
                      {conn ? conn.name || providerInfo(conn.kind).label : "Removed connection"}
                    </span>
                  </th>
                  <td data-label="Context">
                    <NumberInput
                      aria-label={`Context for ${f.model}`}
                      min={1000}
                      step={1000}
                      integer
                      allowEmpty
                      placeholder={String(settings.contextTokens)}
                      value={f.context}
                      onChange={(context) => onFavorite(f, { context })}
                    />
                  </td>
                  <td data-label="Thinking">
                    <select
                      aria-label={`Thinking for ${f.model}`}
                      value={thinkingKey(f.disableThinking)}
                      onChange={(e) => onFavorite(f, { disableThinking: THINKING_OPTIONS.find((o) => thinkingKey(o.off) === e.target.value)!.off })}
                    >
                      {THINKING_OPTIONS.filter((o) => !o.onlyIfSet || thinkingKey(o.off) === thinkingKey(f.disableThinking)).map((o) => (
                        <option key={thinkingKey(o.off)} value={thinkingKey(o.off)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {MODEL_USES.map((u) => (
                    <td key={u.id} data-label={u.label} className="job">
                      <input
                        type="checkbox"
                        title={`Offer it in the ${u.label} pickers`}
                        aria-label={`Offer ${name} for ${u.label}`}
                        checked={offered(f, u.id)}
                        onChange={(e) => setOffered(f, u.id, e.target.checked)}
                      />
                    </td>
                  ))}
                  <td className="model-remove">
                    <button type="button" className="secondary" onClick={() => onRemove(f)} aria-label={`Stop using ${f.model}`}>
                      Stop using
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Default model for each job</h3>
      <div className="job-defaults">
        {MODEL_USES.map((u) => (
          <label key={u.id}>
            {u.label}
            <JobDefault settings={settings} use={u.id} onChange={(ref) => onSave(withJobDefault(settings, u.id, ref))} />
          </label>
        ))}
      </div>
    </>
  );
}
