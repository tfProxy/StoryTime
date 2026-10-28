"use client";

import { useState } from "react";
import {
  FACT_LIMITS,
  factHistory,
  FORM_ASPECT,
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
  readOnly?: boolean;
  onSaved: () => void;
};

type Body = { op: "set" | "retire"; aspect: string; form: string; text: string; quote: string; fact_id?: string; anchor: string };

const NEW_FORM = "\u0000new";

export default function CodexFacts({ entry, factOps, path, chapterId, usedAspects, readOnly, onSaved }: Props) {
  const [mode, setMode] = useState<null | "fact" | "form">(null);
  const [editing, setEditing] = useState<LiveFact | null>(null);
  const [showAi, setShowAi] = useState(false);
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
  const groups: { key: string; heading: string | null; form: string; facts: LiveFact[]; dim: boolean }[] = [];
  const every = rows.filter((f) => f.form === "");
  if (every.length) groups.push({ key: "", heading: hasForms ? "Every form" : null, form: "", facts: every, dim: false });
  for (const name of entry.forms) {
    const facts = rows.filter((f) => f.form !== "" && sameAspect(f.form, name));
    if (!facts.length) continue;
    const cur = isCurrent(name);
    groups.push({
      key: name,
      heading: cur ? `${name} (current)` : `${name} (not current: not sent to the AI)`,
      form: name,
      facts,
      dim: !cur,
    });
  }

  const canSetForm = !readOnly && entry.type === "character";

  return (
    <div className="facts">
      {entry.form && (
        <p className="facts-form">
          <strong>Form: {entry.form.name}</strong>
          {entry.form.note && <> — {entry.form.note}</>}{" "}
          {!readOnly && (
            <button type="button" className="secondary" disabled={busy} onClick={() => setMode(mode === "form" ? null : "form")}>
              Change form
            </button>
          )}
        </p>
      )}
      {!entry.form && canSetForm && (
        <p className="meta" style={{ margin: "0 0 0.5rem" }}>
          <button type="button" className="linkish" disabled={busy} onClick={() => setMode(mode === "form" ? null : "form")}>
            Set a form
          </button>
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key} className={g.dim ? "fact-group dim" : "fact-group"}>
          {g.heading && <h3 className="fact-heading">{g.heading}</h3>}
          {g.facts.map((f) => (
            <FactRow
              key={f.fact_id}
              fact={f}
              history={factHistory(factOps, f.fact_id)}
              since={since(f.op.anchor_chapter_id)}
              here={f.op.anchor_chapter_id === chapterId}
              titleOf={titleOf}
              readOnly={readOnly}
              busy={busy}
              onChange={() => {
                setEditing(f);
                setMode("fact");
              }}
              onRemove={() => {
                if (window.confirm(`Remove “${f.aspect || f.text}” from this chapter onward? Earlier chapters keep it.`)) {
                  void send({ op: "retire", aspect: f.aspect, form: f.form, text: "", quote: "", fact_id: f.fact_id, anchor: chapterId });
                }
              }}
            />
          ))}
        </div>
      ))}

      {error && <p className="error">{error}</p>}

      {mode === "fact" && (
        <FactForm
          key={editing?.fact_id ?? "new"}
          entry={entry}
          editing={editing}
          path={path}
          chapterId={chapterId}
          usedAspects={usedAspects}
          busy={busy}
          onCancel={() => {
            setMode(null);
            setEditing(null);
          }}
          onSave={async (b) => {
            if (await send(b)) {
              setMode(null);
              setEditing(null);
            }
          }}
        />
      )}
      {mode === "form" && (
        <FormForm
          entry={entry}
          path={path}
          chapterId={chapterId}
          busy={busy}
          onCancel={() => setMode(null)}
          onSave={async (b) => {
            if (await send(b)) setMode(null);
          }}
        />
      )}

      <div className="meta" style={{ margin: "0.25rem 0 0.5rem" }}>
        {!readOnly && mode !== "fact" && (
          <>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setMode("fact");
              }}
            >
              + Add a fact
            </button>{" "}
          </>
        )}
        <button type="button" className="linkish" onClick={() => setShowAi(!showAi)}>
          {showAi ? "Hide what the AI reads" : "What the AI reads"}
        </button>
      </div>
      {showAi && <div className="fact-ai">{entry.description || <em>(nothing yet)</em>}</div>}
    </div>
  );
}

function FactRow({
  fact,
  history,
  since,
  here,
  titleOf,
  readOnly,
  busy,
  onChange,
  onRemove,
}: {
  fact: LiveFact;
  history: FactOp[];
  since: string;
  here: boolean;
  titleOf: (id: string) => string;
  readOnly?: boolean;
  busy: boolean;
  onChange: () => void;
  onRemove: () => void;
}) {
  const versions = [...history].reverse();
  return (
    <details className="fact-row">
      <summary>
        <div className="fact-summary">
          <div className="fact-line">
            {fact.aspect && <strong>{fact.aspect}</strong>} <span>{fact.text}</span>
          </div>
          <div className="meta" style={{ margin: 0 }}>
            {since}
            {here && <span className="tag"> · changed here</span>}
          </div>
        </div>
      </summary>
      <ol className="history">
        {versions.map((v, i) => (
          <li key={v.id}>
            <div className="meta" style={{ margin: 0 }}>
              {v.op === "retire" ? <strong>Removed</strong> : <strong>{i === versions.length - 1 ? "Added" : "Changed"}</strong>} in “
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
      {!readOnly && (
        <div className="row" style={{ margin: "0.5rem 0 0" }}>
          <button type="button" className="secondary" disabled={busy} onClick={onChange}>
            Change
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </details>
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
        Aspect <small>(what it describes, such as Ears; leave empty for a loose fact)</small>
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
        <input aria-label="New form name" placeholder="New form name" value={newForm} maxLength={FACT_LIMITS.form} onChange={(e) => setNewForm(e.target.value)} />
      )}
      <label>
        Text
        <textarea aria-label="Fact" rows={2} value={text} maxLength={FACT_LIMITS.text} onChange={(e) => setText(e.target.value)} />
      </label>
      {replaced && !editing && <p className="meta" style={{ margin: 0 }}>This replaces: {replaced.text}</p>}
      <label>
        Quote from the chapter <small>(optional)</small>
        <input aria-label="Quote from the chapter" value={quote} maxLength={FACT_LIMITS.quote} onChange={(e) => setQuote(e.target.value)} />
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
  const [name, setName] = useState(entry.form?.name ?? "");
  const [note, setNote] = useState(entry.form?.note ?? "");
  const [anchor, setAnchor] = useState(chapterId);
  return (
    <div className="fact-form">
      <label>
        Form name <small>(which form {entry.name} is in now; only its facts go to the AI)</small>
        <input aria-label="Form name" list={`forms-${entry.entry_id}`} value={name} maxLength={FACT_LIMITS.form} onChange={(e) => setName(e.target.value)} />
        <datalist id={`forms-${entry.entry_id}`}>
          {entry.forms.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <label>
        Note <small>(optional, such as “changing, mostly vixen”)</small>
        <input aria-label="Form note" value={note} maxLength={FACT_LIMITS.text} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ChapterSelect path={path} value={anchor} onChange={setAnchor} />
      <div className="row">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            onSave({ op: "set", aspect: FORM_ASPECT, form: name.trim(), text: note.trim(), quote: "", fact_id: entry.form?.fact.fact_id, anchor })
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
