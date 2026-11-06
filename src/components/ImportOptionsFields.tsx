"use client";

import { IMPORT_LIMITS, type ImportOptions } from "@/lib/textImport";

/** Chapter length and how many other choices to suggest: on the import form, and again for "Split again". */
export default function ImportOptionsFields({ options, onChange }: { options: ImportOptions; onChange: (o: ImportOptions) => void }) {
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Math.round(Number(v)) : fallback);
  return (
    <>
      <fieldset className="import-length">
        <legend>Chapter length</legend>
        <label>
          From
          <input
            type="number"
            aria-label="Shortest chapter, in words"
            min={IMPORT_LIMITS.minWords.min}
            max={IMPORT_LIMITS.minWords.max}
            value={options.minWords}
            onChange={(e) => onChange({ ...options, minWords: num(e.target.value, options.minWords) })}
          />
        </label>
        <label>
          to
          <input
            type="number"
            aria-label="Longest chapter, in words"
            min={IMPORT_LIMITS.maxWords.min}
            max={IMPORT_LIMITS.maxWords.max}
            value={options.maxWords}
            onChange={(e) => onChange({ ...options, maxWords: num(e.target.value, options.maxWords) })}
          />
        </label>
        <span>words</span>
      </fieldset>
      {options.maxWords <= options.minWords && <p className="error">The longest chapter must be longer than the shortest.</p>}
      <label className="import-alternatives">
        <span>Other choices to suggest at each break</span>
        <select value={options.alternatives} onChange={(e) => onChange({ ...options, alternatives: Number(e.target.value) })}>
          {Array.from({ length: IMPORT_LIMITS.alternatives + 1 }, (_, i) => (
            <option key={i} value={i}>
              {i === 0 ? "None" : i}
            </option>
          ))}
        </select>
        <small>Saved as choices with no chapter yet, ready to write. After the last chapter they are other endings.</small>
      </label>
    </>
  );
}
