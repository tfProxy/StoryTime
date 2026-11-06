"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ModelPicker from "./ModelPicker";
import ImportOptionsFields from "./ImportOptionsFields";
import { countWords, DEFAULT_IMPORT_OPTIONS, IMPORT_LIMITS, parseStoryText, type ImportOptions } from "@/lib/textImport";
import type { ModelRef } from "@/lib/settingsSchema";

/** New story › Import a story: the text, how to split it, and the button that queues the splitting. */
export default function ImportTextForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseStoryText(text), [text]);
  const words = useMemo(() => parsed.paragraphs.reduce((n, p) => n + countWords(p), 0), [parsed]);
  const tooLong = text.length > IMPORT_LIMITS.text;

  async function onFile(file: File) {
    setError(null);
    try {
      setText(await file.text());
    } catch {
      setError("Couldn't read that file.");
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, options }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Import failed (${res.status})`);
      router.push(out.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="import-form">
      <div className="card import-text">
        <div className="row import-text-head">
          <label htmlFor="import-text">The story</label>
          <span className="meta">
            {words.toLocaleString("en")} word{words === 1 ? "" : "s"} · {parsed.paragraphs.length} paragraph{parsed.paragraphs.length === 1 ? "" : "s"}
          </span>
          <label className="button secondary import-file">
            Choose a file (.txt, .md)…
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden aria-label="Story text file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
        <textarea id="import-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the story here." />
        <p className="meta">Markdown headings (#, ##) and scene breaks (***, ---) are used as hints for where to break, and a heading becomes the chapter’s title.</p>
      </div>
      <div className="card import-options">
        <label className="import-model">
          <span>Model for splitting</span>
          <ModelPicker
            value={options.model}
            role="main"
            use="write"
            label="Model for splitting"
            onChange={(model: ModelRef | null) => setOptions((o) => ({ ...o, model }))}
          />
        </label>
        <ImportOptionsFields options={options} onChange={setOptions} />
        <p className="meta">The original path is always recorded. You can show or hide it while reading and on the outline.</p>
      </div>
      {tooLong && <p className="error">The story is too long to import (at most {IMPORT_LIMITS.text.toLocaleString("en")} characters).</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" onClick={start} disabled={busy || parsed.paragraphs.length === 0 || tooLong || options.maxWords <= options.minWords}>
          {busy ? "Starting…" : "Split into chapters"}
        </button>
        <span className="meta" style={{ margin: 0 }}>
          Nothing is saved as a story until you review the chapters.
        </span>
      </div>
    </div>
  );
}
