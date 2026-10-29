"use client";

import { useState } from "react";
import {
  FACT_LIMITS,
  factHistory,
  FORM_ASPECT,
  formLine,
  isFormAspect,
  sameAspect,
  STARTER_ASPECTS,
  type CodexEntry,
  type FactOp,
  type LiveFact,
} from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";

type Props = {
  entry: CodexEntry;
  /** Every fact op on the path, for each fact's history. */
  factOps: FactOp[];
  path: PathChapter[];
  /** The chapter whose codex is shown; the default for "Takes effect from". */
  chapterId: string;
  /** Aspects used anywhere in this codex, offered when adding a fact. */
  usedAspects: string[];
  onSaved: () => void;
};

type Body = { op: "set" | "retire"; aspect: string; form: string; text: string; quote: string; fact_id?: string; anchor: string };

const NEW_FORM = "\u0000new";

/**
 * An entry's form and facts. Every form opens directly beneath the button (or row) that opened it, and the
 * add form at the end of the list.
 */
export default function CodexFacts({ entry, factOps, path, chapterId, usedAspects, onSaved }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  // A fact's id while it is being changed, "new" while one is being added.
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOf = (id: string) => path.find((p) => p.id === id)?.title ?? "an earlier chapter";
  const since = (id: string) => (path[0]?.id === id ? "from the start" : `since “${titleOf(id)}”`);

  async function send(b: Body): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor_chapter_id: b.anchor,
          entry_id: entry.entry_id,
          fact_id: b.fact_id,
          op: b.op,
          aspect: b.aspect,
          form: b.form,
          text: b.text,
          quote: b.quote,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onSaved();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rows = entry.facts.filter((f) => !isFormAspect(f.aspect));
  const hasForms = entry.forms.length > 0;
  const current = entry.form?.name ?? null;
  const isCurrent = (name: string) => current !== null && sameAspect(name, current);
  const groups: { key: string; heading: string | null; facts: LiveFact[]; dim: boolean }[] = [];
  const every = rows.filter((f) => f.form === "");
  if (every.length) groups.push({ key: "", heading: hasForms ? "Every form" : null, facts: every, dim: false });
  for (const name of entry.forms) {
    const facts = rows.filter((f) => f.form !== "" && sameAspect(f.form, name));
    if (!facts.length) continue;
    const cur = isCurrent(name);
    groups.push({ key: name, heading: cur ? `${name} (current)` : `${name} (not current: not sent to the AI)`, facts, dim: !cur });
  }

  const showForm = hasForms || entry.type === "character" || entry.form !== null;
  const toggleHistory = (id: string) => setHistory(history.includes(id) ? history.filter((h) => h !== id) : [...history, id]);

  return (
    <>
      {showForm && (
        <section className="entry-section">
          <h2>Form</h2>
          <p className="facts-form">
            {entry.form ? (
              <>
                <strong>Form: {entry.form.name}</strong>
                {entry.form.note && <> — {entry.form.note}</>}
              </>
            ) : (
              <span className="meta">No form set.</span>
            )}{" "}
            {!formOpen && (
              <button type="button" className="secondary" disabled={busy} onClick={() => setFormOpen(true)}>
                {entry.form ? "Change form" : "Set a form"}
              </button>
            )}
          </p>
          {formOpen && (
            <FormForm
              entry={entry}
              path={path}
              chapterId={chapterId}
              busy={busy}
              onCancel={() => setFormOpen(false)}
              onSave={async (b) => {
                if (await send(b)) setFormOpen(false);
              }}
            />
          )}
        </section>
      )}

      <section className="entry-section facts">
        <h2>Facts</h2>
        {groups.length === 0 && <p className="meta">No facts yet.</p>}
        {groups.map((g) => (
          <div key={g.key} className={g.dim ? "fact-group dim" : "fact-group"}>
            {g.heading && <h3 className="fact-heading">{g.heading}</h3>}
            {g.facts.map((f) => {
              const versions = [...factHistory(factOps, f.fact_id)].reverse();
              return (
                <div key={f.fact_id} className="fact-row">
                  <div className="fact-summary">
                    <div className="fact-line">
                      {f.aspect && <strong>{f.aspect}</strong>} <span>{f.text}</span>
                    </div>
                    <div className="meta" style={{ margin: 0 }}>
                      {since(f.op.anchor_chapter_id)}
                      {f.op.anchor_chapter_id === chapterId && <span className="tag"> · changed here</span>}
                    </div>
                  </div>
                  <div className="row" style={{ margin: "0.4rem 0 0" }}>
                    <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(f.fact_id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove “${f.aspect || f.text}” from this chapter onward? Earlier chapters keep it.`)) {
                          void send({ op: "retire", aspect: f.aspect, form: f.form, text: "", quote: "", fact_id: f.fact_id, anchor: chapterId });
                        }
                      }}
                    >
                      Remove
                    </button>
                    <button type="button" className="linkish" aria-expanded={history.includes(f.fact_id)} onClick={() => toggleHistory(f.fact_id)}>
                      History
                    </button>
                  </div>
                  {editing === f.fact_id && (
                    <FactForm
                      key={f.fact_id}
                      entry={entry}
                      editing={f}
                      path={path}
                      chapterId={chapterId}
                      usedAspects={usedAspects}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={async (b) => {
                        if (await send(b)) setEditing(null);
                      }}
                    />
                  )}
                  {history.includes(f.fact_id) && (
                    <ol className="history">
                      {versions.map((v, i) => (
                        <li key={v.id}>
                          <div className="meta" style={{ margin: 0 }}>
                            <strong>{v.op === "retire" ? "Removed" : i === versions.length - 1 ? "Added" : "Changed"}</strong> in “
                            {titleOf(v.anchor_chapter_id)}”{i === 0 && v.op !== "retire" ? " · current" : ""}
                          </div>
                          {v.op !== "retire" && (
                            <div className={i === 0 ? "version" : "version old"}>
                              {v.text}
                              {v.quote && <div className="fact-quote">“{v.quote}”</div>}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {error && <p className="error">{error}</p>}

        {editing === "new" ? (
          <FactForm
            key="new"
            entry={entry}
            editing={null}
            path={path}
            chapterId={chapterId}
            usedAspects={usedAspects}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (b) => {
              if (await send(b)) setEditing(null);
            }}
          />
        ) : (
          <p style={{ margin: "0.5rem 0 0" }}>
            <button type="button" className="secondary" disabled={busy} onClick={() => setEditing("new")}>
              + Add a fact
            </button>
          </p>
        )}
      </section>
    </>
  );
}

function ChapterSelect({ path, value, onChange }: { path: PathChapter[]; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Takes effect from
      <select aria-label="Takes effect from" value={value} onChange={(e) => onChange(e.target.value)}>
        {path.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function FactForm({
  entry,
  editing,
  path,
  chapterId,
  usedAspects,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  editing: LiveFact | null;
  path: PathChapter[];
  chapterId: string;
  usedAspects: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (b: Body) => void;
}) {
  const [aspect, setAspect] = useState(editing?.aspect ?? "");
  const [formSel, setFormSel] = useState(editing?.form ?? "");
  const [newForm, setNewForm] = useState("");
  const [text, setText] = useState(editing?.text ?? "");
  const [quote, setQuote] = useState("");
  const [anchor, setAnchor] = useState(chapterId);

  const showForm = entry.forms.length > 0 || entry.type === "character";
  const form = formSel === NEW_FORM ? newForm.trim() : formSel;
  const suggestions: string[] = [];
  for (const a of [...STARTER_ASPECTS[entry.type], ...usedAspects]) {
    if (a.trim() && !isFormAspect(a) && !suggestions.some((s) => sameAspect(s, a))) suggestions.push(a.trim());
  }
  // A fact with the same aspect and form is replaced (an aspect-less loose fact is always new).
  const replaced = editing
    ? editing
    : aspect.trim()
      ? entry.facts.find((f) => !isFormAspect(f.aspect) && sameAspect(f.aspect, aspect) && sameAspect(f.form, form))
      : undefined;

  return (
    <div className="fact-form">
      <label>
        Aspect
        <input
          aria-label="Aspect"
          list={`aspects-${entry.entry_id}`}
          value={aspect}
          maxLength={FACT_LIMITS.aspect}
          onChange={(e) => setAspect(e.target.value)}
        />
        <datalist id={`aspects-${entry.entry_id}`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <small>what it describes, such as Ears; leave empty for a loose fact</small>
      </label>
      {showForm && (
        <label>
          Form
          <select aria-label="Form" value={formSel} onChange={(e) => setFormSel(e.target.value)}>
            <option value="">Every form</option>
            {entry.forms.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value={NEW_FORM}>New form…</option>
          </select>
        </label>
      )}
      {showForm && formSel === NEW_FORM && (
        <input className="fact-form-extra" aria-label="New form name" placeholder="New form name" value={newForm} maxLength={FACT_LIMITS.form} onChange={(e) => setNewForm(e.target.value)} />
      )}
      <label>
        Text
        <textarea aria-label="Fact" rows={2} value={text} maxLength={FACT_LIMITS.text} onChange={(e) => setText(e.target.value)} />
      </label>
      {replaced && !editing && <p className="meta" style={{ margin: 0 }}>This replaces: {replaced.text}</p>}
      <label>
        Quote from the chapter
        <input aria-label="Quote from the chapter" placeholder="optional" value={quote} maxLength={FACT_LIMITS.quote} onChange={(e) => setQuote(e.target.value)} />
      </label>
      <ChapterSelect path={path} value={anchor} onChange={setAnchor} />
      <div className="row">
        <button
          type="button"
          disabled={busy || !text.trim() || (formSel === NEW_FORM && !newForm.trim())}
          onClick={() =>
            onSave({ op: "set", aspect: !editing && replaced ? replaced.aspect : aspect.trim(), form, text: text.trim(), quote: quote.trim(), fact_id: replaced?.fact_id, anchor })
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormForm({
  entry,
  path,
  chapterId,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  path: PathChapter[];
  chapterId: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (b: Body) => void;
}) {
  // The entry's forms, or a new one: with no form yet, a new one is the only choice.
  const currentName = entry.form?.name ?? "";
  const [sel, setSel] = useState(() => entry.forms.find((f) => sameAspect(f, currentName)) ?? entry.forms[0] ?? NEW_FORM);
  const [newName, setNewName] = useState("");
  const [stage, setStage] = useState(entry.form?.note ?? "");
  const [anchor, setAnchor] = useState(chapterId);
  const name = sel === NEW_FORM ? newName.trim() : sel;
  const line = name ? formLine(name, stage) : "";
  return (
    <div className="fact-form">
      <label>
        Form
        <select aria-label="Form" value={sel} onChange={(e) => setSel(e.target.value)}>
          {entry.forms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={NEW_FORM}>New form…</option>
        </select>
        <small>which form {entry.name} is in now; only its facts go to the AI</small>
      </label>
      {sel === NEW_FORM && (
        <input className="fact-form-extra" aria-label="New form name" placeholder="New form name" value={newName} maxLength={FACT_LIMITS.form} onChange={(e) => setNewName(e.target.value)} />
      )}
      <label>
        Stage (optional)
        <input aria-label="Stage (optional)" placeholder="e.g. halfway, complete" value={stage} maxLength={FACT_LIMITS.text} onChange={(e) => setStage(e.target.value)} />
        <small>how far along it is, such as “halfway”</small>
      </label>
      <p className="meta" style={{ margin: 0 }} aria-live="polite">
        {line ? <>The AI will read: <strong>{line}</strong></> : "Pick or name a form to see what the AI will read."}
      </p>
      <ChapterSelect path={path} value={anchor} onChange={setAnchor} />
      <div className="row">
        <button
          type="button"
          disabled={busy || !name}
          onClick={() => onSave({ op: "set", aspect: FORM_ASPECT, form: name, text: stage.trim(), quote: "", fact_id: entry.form?.fact.fact_id, anchor })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
