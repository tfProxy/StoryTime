"use client";

import { providerInfo } from "@/lib/ai/providers";
import {
  findConnection,
  jobRef,
  MODEL_USES,
  modelLabel,
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
 * Settings › Writing: one row per model in use, with its own settings (nickname, context, thinking) and, for each job,
 * whether its pickers offer the model and whether it is the job's default. On a phone each row is a card.
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
  const defaults = new Map(MODEL_USES.map((u) => [u.id, jobRef(settings, u.id)]));
  // A job whose default isn't a model in use (or that has none) says so under the grid.
  const unlisted = MODEL_USES.filter((u) => !favs.some((f) => sameRef(f, defaults.get(u.id))));

  const offered = (f: Favorite, u: ModelUse) => !f.hiddenFrom.includes(u);
  const setOffered = (f: Favorite, u: ModelUse, on: boolean) =>
    onFavorite(f, { hiddenFrom: on ? f.hiddenFrom.filter((x) => x !== u) : [...f.hiddenFrom, u] });

  return (
    <>
      <p className="meta">
        For each job, the box offers the model in that job&apos;s pickers and the round button makes it the job&apos;s default.
        Pages with their own model picker (the writing page, Write ahead, Illustrate) can still choose another. A blank
        Context uses the Context budget under Options.
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
                      <span className="job-controls">
                        <label title={`Offer it in the ${u.label} pickers`}>
                          <input
                            type="checkbox"
                            aria-label={`Offer ${name} for ${u.label}`}
                            checked={offered(f, u.id)}
                            onChange={(e) => setOffered(f, u.id, e.target.checked)}
                          />
                        </label>
                        <label title={`The default for ${u.label}`}>
                          <input
                            type="radio"
                            name={`default-${u.id}`}
                            aria-label={`${name}: default for ${u.label}`}
                            checked={sameRef(defaults.get(u.id), f)}
                            onChange={() => onSave(withJobDefault(settings, u.id, f))}
                          />
                        </label>
                      </span>
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
      {unlisted.map((u) => {
        const ref: ModelRef | null | undefined = defaults.get(u.id);
        return (
          <p key={u.id} className="meta">
            {u.label}: {ref ? `the default is ${modelLabel(settings, ref)}, which isn't in use.` : "no default yet; choose one with the round button."}
          </p>
        );
      })}
    </>
  );
}
