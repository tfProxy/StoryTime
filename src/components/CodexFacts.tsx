"use client";

import { useState } from "react";
import {
  DRAFT_ANCHOR,
  FACT_LIMITS,
  factHistory,
  factSharedState,
  FORM_ASPECT,
  formClashes,
  formLine,
  isDraftEntry,
  isFormAspect,
  sameAspect,
  STARTER_ASPECTS,
  type CodexEntry,
  type FactOp,
  type FormClash,
  type LiveFact,
} from "@/lib/codex";
import type { PathChapter } from "@/lib/ai/codexAi";
import { entryHints } from "@/lib/codexHints";
import { useSettings } from "@/lib/settings";
import ChapterPathPicker from "./ChapterPathPicker";
import EntryFold from "./EntryFold";

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
  /** The chapters offered under "Takes effect from" (default `path`). */
  anchorPath?: PathChapter[];
  /** In the writing page's drawer: holds a change in the draft, offered as "This chapter" and picked by default. */
  hold?: (f: HeldFact) => void;
  /** The draft edits an existing chapter, so held changes are saved when it is saved. */
  editingChapter?: boolean;
};

type Body = { op: "set" | "retire"; aspect: string; form: string; text: string; quote: string; fact_id?: string; anchor: string };
/** A fact change for the draft to hold: no fact_id for a new fact. */
export type HeldFact = Omit<Body, "anchor">;
/** A held change is saved when the new chapter is posted, or when the edited chapter is saved. */
type Held = "post" | "save";

const NEW_FORM = "\u0000new";

/**
 * An entry's form and facts. Every form opens directly beneath the button (or row) that opened it, and the
 * add form at the end of the list.
 */
export default function CodexFacts({ entry, factOps, path, chapterId, usedAspects, onSaved, anchorPath = path, hold, editingChapter = false }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  // A fact's id while it is being changed, "new" while one is being added.
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();

  const titleOf = (id: string) => (id === DRAFT_ANCHOR ? "this chapter" : (path.find((p) => p.id === id)?.title ?? "an earlier chapter"));
  const since = (id: string) => (id === DRAFT_ANCHOR ? "from this chapter" : path[0]?.id === id ? "from the start" : `since “${titleOf(id)}”`);
  // In the drawer, changes are held in the draft unless an earlier chapter is picked.
  const startAnchor = hold ? DRAFT_ANCHOR : chapterId;
  const heldLabel: Held | undefined = hold ? (editingChapter ? "save" : "post") : undefined;

  // On a linked entry: which facts are the shared entry's own, changed by this story, or only the story's.
  const sharedState = (factId: string) => factSharedState(factHistory(factOps, factId));
  // Shared facts this story has hidden (its latest version of them is a removal).
  const hiddenShared = entry.shared_entry_id
    ? [...new Set(factOps.filter((o) => o.entry_id === entry.entry_id).map((o) => o.fact_id))].flatMap((id) => {
        const h = factHistory(factOps, id);
        const last = h[h.length - 1];
        if (!last || last.op !== "retire" || !h.some((o) => o.id.startsWith("shared-"))) return [];
        const shown = [...h].reverse().find((o) => o.op === "set") ?? last;
        return [{ fact_id: id, aspect: shown.aspect, text: shown.text }];
      })
    : [];

  /** Takes this story's changes to a shared fact back (the fact reads as the shared entry has it). */
  async function resetShared(factId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/reset-fact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor_chapter_id: chapterId, entry_id: entry.entry_id, fact_id: factId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Request failed (${res.status})`);
      else onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send(b: Body): Promise<boolean> {
    if (hold && b.anchor === DRAFT_ANCHOR) {
      hold({ op: b.op, aspect: b.aspect, form: b.form, text: b.text, quote: b.quote, fact_id: b.fact_id });
      return true;
    }
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

  /** Saves a form change. Facts moved to the old form are saved at once; in the drawer, the new form and its facts can be held in the draft. */
  async function saveForm(c: FormChange): Promise<boolean> {
    const formFact: Body = { op: "set", aspect: FORM_ASPECT, form: c.name, text: c.stage, quote: "", fact_id: entry.form?.fact.fact_id, anchor: c.anchor };
    if (!c.baseForm && c.move.length === 0 && c.add.length === 0) return send(formFact);
    const holdIt = !!hold && c.anchor === DRAFT_ANCHOR;
    if (holdIt && !c.baseForm && c.move.length === 0) {
      for (const b of [formFact, ...c.add.map((a): Body => ({ op: "set", aspect: a.aspect, form: c.name, text: a.text, quote: "", anchor: c.anchor }))]) await send(b);
      return true;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/codex/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_id: chapterId,
          entry_id: entry.entry_id,
          form: holdIt ? undefined : { name: c.name, stage: c.stage, anchor_chapter_id: c.anchor },
          base_form: c.baseForm,
          move: c.move,
          add: holdIt ? [] : c.add,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
    if (holdIt) {
      // The base form is saved now, so the held form fact finds it by its aspect when the chapter is saved.
      hold!({ op: "set", aspect: FORM_ASPECT, form: c.name, text: c.stage, quote: "", fact_id: formFact.fact_id });
      for (const a of c.add) hold!({ op: "set", aspect: a.aspect, form: c.name, text: a.text, quote: "" });
    }
    onSaved();
    return true;
  }

  const rows = entry.facts.filter((f) => !isFormAspect(f.aspect));
  const hasForms = entry.forms.length > 0;
  // With no form set, an entry that has had one reads as in its normal form.
  const current = entry.form?.name ?? entry.baseForm;
  const inBase = entry.form !== null && entry.baseForm !== null && sameAspect(entry.form.name, entry.baseForm);
  // Facts of a form, but no form was ever set: they can't apply, and the AI isn't sent them.
  const needsForm = entry.form === null && entry.baseForm === null && hasForms;
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
  const clashes = formClashes(entry);
  // In the writing drawer the chapter being written isn't on the path, so whether the entry is mentioned isn't checked there.
  const hints = entryHints(entry, { chapterTexts: hold ? undefined : path.map((c) => c.body), contextTokens: settings.contextTokens });
  /**
   * Fixes a clash: the every-form fact becomes the given form's (null: is removed), from the chapter where it was set,
   * so it reads that way from the start. A fact held in the draft is changed in the draft.
   */
  const moveClash = (c: FormClash, form: string | null) =>
    send({
      op: form === null ? "retire" : "set",
      aspect: c.every.aspect,
      form: form ?? "",
      text: form === null ? "" : c.every.text,
      quote: form === null ? "" : c.every.quote,
      fact_id: c.every.fact_id,
      anchor: c.every.op.anchor_chapter_id,
    });
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
          {entry.baseForm && (
            <p className="meta" style={{ margin: "0.25rem 0 0" }}>
              {inBase
                ? `${entry.baseForm} is the normal form, so the AI isn't told the form, only its facts, unless it has just changed back.`
                : `Normal form: ${entry.baseForm}. The AI is told when ${entry.name} is in another form.`}
            </p>
          )}
          {needsForm && (
            <p className="notice">
              Some facts are for a form ({entry.forms.join(", ")}), but no form is set, so the AI isn&apos;t sent them. Set the current form to
              include them.
            </p>
          )}
          {formOpen && (
            <FormForm
              entry={entry}
              path={anchorPath}
              chapterId={startAnchor}
              held={heldLabel}
              busy={busy}
              onCancel={() => setFormOpen(false)}
              onSave={async (c) => {
                if (await saveForm(c)) setFormOpen(false);
              }}
            />
          )}
        </section>
      )}

      <EntryFold title="Facts" id="entry-facts" className="facts" open note={rows.length > 0 ? `${rows.length}` : undefined}>
        {groups.length === 0 && <p className="meta">No facts yet.</p>}
        {clashes.length > 0 && (
          <div className="notice form-clashes">
            <p>
              {clashes.length === 1 ? "This fact is" : "These facts are"} for every form, but a form has its own: while {entry.name} is in that form, the AI
              reads both.
            </p>
            <ul>
              {clashes.map((c) => (
                <ClashRow key={c.every.fact_id} clash={c} busy={busy} onMove={(form) => void moveClash(c, form)} onRemove={() => void moveClash(c, null)} />
              ))}
            </ul>
          </div>
        )}
        {hints.length > 0 && (
          <div className="notice codex-hints" role="note" aria-label="Hints">
            <ul>
              {hints.map((h) => (
                <li key={h.key}>{h.text}</li>
              ))}
            </ul>
          </div>
        )}
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
                      {f.op.anchor_chapter_id === DRAFT_ANCHOR ? (
                        <span className="tag"> · not saved yet</span>
                      ) : (
                        f.op.anchor_chapter_id === chapterId && <span className="tag"> · changed here</span>
                      )}
                      {entry.shared_entry_id && sharedState(f.fact_id) === "base" && <span className="tag"> · shared</span>}
                      {entry.shared_entry_id && sharedState(f.fact_id) === "changed" && <span className="tag"> · shared, changed in this story</span>}
                      {entry.shared_entry_id && sharedState(f.fact_id) === "own" && <span className="tag"> · this story only</span>}
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
                          void send({ op: "retire", aspect: f.aspect, form: f.form, text: "", quote: "", fact_id: f.fact_id, anchor: startAnchor });
                        }
                      }}
                    >
                      Remove
                    </button>
                    {entry.shared_entry_id && !hold && sharedState(f.fact_id) === "changed" && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => void resetShared(f.fact_id)}>
                        Reset to the shared fact
                      </button>
                    )}
                    <button type="button" className="linkish" aria-expanded={history.includes(f.fact_id)} onClick={() => toggleHistory(f.fact_id)}>
                      History
                    </button>
                  </div>
                  {editing === f.fact_id && (
                    <FactForm
                      key={f.fact_id}
                      entry={entry}
                      editing={f}
                      path={anchorPath}
                      chapterId={startAnchor}
                      held={heldLabel}
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
            path={anchorPath}
            chapterId={startAnchor}
            held={heldLabel}
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
        {hiddenShared.length > 0 && (
          <div className="fact-group dim">
            <h3 className="fact-heading">Hidden from the shared entry</h3>
            {hiddenShared.map((h) => (
              <div key={h.fact_id} className="fact-row">
                <div className="fact-line">
                  {h.aspect && <strong>{h.aspect}</strong>} <span>{h.text}</span>
                </div>
                <div className="row" style={{ margin: "0.4rem 0 0" }}>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void resetShared(h.fact_id)}>
                    Show again
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </EntryFold>
    </>
  );
}

function ChapterSelect({
  path,
  chapterId,
  held,
  value,
  onChange,
}: {
  path: PathChapter[];
  chapterId: string;
  held?: Held;
  value: string;
  onChange: (v: string) => void;
}) {
  return <ChapterPathPicker path={path} currentId={chapterId} value={value} onChange={onChange} draft={!!held} editing={held === "save"} />;
}

/** One clash: the two facts, and a button that makes the every-form one belong to the form it fits (or removes it). */
function ClashRow({ clash, busy, onMove, onRemove }: { clash: FormClash; busy: boolean; onMove: (form: string) => void; onRemove: () => void }) {
  const { every, clashes, fitsIn } = clash;
  const [target, setTarget] = useState(fitsIn[0] ?? "");
  const label = `${every.aspect}: ${every.text}`;
  return (
    <li>
      <span>
        <strong>{every.aspect}:</strong> {every.text} <span className="meta">(every form)</span>
        {clashes.map((c) => (
          <span key={c.fact.fact_id}>
            {" "}
            · {c.fact.text} <span className="meta">({c.form})</span>
          </span>
        ))}
      </span>
      <span className="row form-clash-fix">
        {fitsIn.length === 0 ? (
          <>
            <span className="meta">Every form has its own {every.aspect}, so this one isn&apos;t needed.</span>
            <button type="button" className="secondary" disabled={busy} aria-label={`Remove “${label}”`} onClick={onRemove}>
              Remove it
            </button>
          </>
        ) : (
          <>
            {fitsIn.length > 1 && (
              <select aria-label={`Form for “${label}”`} value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "auto" }}>
                {fitsIn.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="secondary" disabled={busy || !target} aria-label={`Make “${label}” a ${target} fact`} onClick={() => onMove(target)}>
              {fitsIn.length > 1 ? "Move" : `Move to ${target}`}
            </button>
          </>
        )}
      </span>
    </li>
  );
}

function FactForm({
  entry,
  editing,
  path,
  chapterId,
  held,
  usedAspects,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  editing: LiveFact | null;
  path: PathChapter[];
  /** The chapter picked at first under "Takes effect from" (DRAFT_ANCHOR when `held` is given). */
  chapterId: string;
  /** When "This chapter" is held in the draft: whether it is saved when the chapter is posted or saved. */
  held?: Held;
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
      <ChapterSelect path={path} chapterId={chapterId} held={held} value={anchor} onChange={setAnchor} />
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

/** What the form panel saves: the new form, and how the facts are sorted between it and the old one. */
type FormChange = {
  name: string;
  stage: string;
  anchor: string;
  /** The entry's form until now, when it never had one ("" for none). */
  baseForm: string;
  /** Every-form facts that are only true of the old form. */
  move: string[];
  /** Facts of the new form. */
  add: { aspect: string; text: string }[];
};

/** Aspects that often differ between forms: marked as worth a look when choosing which facts stay with the old form. */
const BODY_ASPECTS = ["Species", "Build", "Height", "Skin", "Fur", "Hair", "Ears", "Eyes", "Tail", "Hands", "Clothing"];

function FormForm({
  entry,
  path,
  chapterId,
  held,
  busy,
  onCancel,
  onSave,
}: {
  entry: CodexEntry;
  path: PathChapter[];
  chapterId: string;
  held?: Held;
  busy: boolean;
  onCancel: () => void;
  onSave: (c: FormChange) => void;
}) {
  // The entry's forms, or a new one: with no form yet, a new one is the only choice.
  const currentName = entry.form?.name ?? "";
  const [sel, setSel] = useState(() => entry.forms.find((f) => sameAspect(f, currentName)) ?? entry.forms[0] ?? NEW_FORM);
  const [newName, setNewName] = useState("");
  const [stage, setStage] = useState(entry.form?.note ?? "");
  const [anchor, setAnchor] = useState(chapterId);
  const name = sel === NEW_FORM ? newName.trim() : sel;
  const line = name ? formLine(name, stage) : "";

  // The form the entry is in until now: its current form, else its normal one. With neither it is asked for.
  const known = entry.form?.name.trim() || entry.baseForm || null;
  const [oldInput, setOldInput] = useState(() => entry.forms[0] ?? "");
  const oldName = (known ?? oldInput).trim();
  // Saved every-form facts can move to the old form (not ones held in the draft, nor an entry only in the draft).
  const movable = isDraftEntry(entry.entry_id) ? [] : entry.facts.filter((f) => !isFormAspect(f.aspect) && f.form === "" && f.op.anchor_chapter_id !== DRAFT_ANCHOR);
  const showMove = movable.length > 0 && !!oldName && !!name && !sameAspect(oldName, name);
  const inNewForm = (aspect: string) =>
    !!aspect.trim() && entry.facts.some((f) => !isFormAspect(f.aspect) && f.form !== "" && sameAspect(f.form, name) && sameAspect(f.aspect, aspect));
  // Ticked by hand, else ticked when the new form already has a fact of the same aspect (the two would clash).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const isTicked = (f: LiveFact) => ticked[f.fact_id] ?? inNewForm(f.aspect);
  const moving = showMove ? movable.filter(isTicked) : [];
  // One "as the new form" box per aspect moved away that the new form doesn't describe yet.
  const replAspects: string[] = [];
  for (const f of moving) if (f.aspect.trim() && !inNewForm(f.aspect) && !replAspects.some((a) => sameAspect(a, f.aspect))) replAspects.push(f.aspect.trim());
  const [repl, setRepl] = useState<Record<string, string>>({});
  const replOf = (aspect: string) => repl[aspect.toLowerCase()] ?? "";

  const save = () =>
    onSave({
      name,
      stage: stage.trim(),
      anchor,
      baseForm: !known && oldName && !sameAspect(oldName, name) ? oldName : "",
      move: moving.map((f) => f.fact_id),
      add: replAspects.map((a) => ({ aspect: a, text: replOf(a).trim() })).filter((a) => a.text),
    });
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
      {!known && (
        <label>
          Form until now
          <input aria-label="Form until now" placeholder="e.g. human" value={oldInput} maxLength={FACT_LIMITS.form} onChange={(e) => setOldInput(e.target.value)} />
          <small>{entry.name}&apos;s form before this, which becomes the normal form; leave empty if there wasn&apos;t one</small>
        </label>
      )}
      <label>
        Stage (optional)
        <input aria-label="Stage (optional)" placeholder="e.g. halfway, complete" value={stage} maxLength={FACT_LIMITS.text} onChange={(e) => setStage(e.target.value)} />
        <small>how far along it is, such as “halfway”</small>
      </label>
      <p className="meta" style={{ margin: 0 }} aria-live="polite">
        {line ? <>The AI will read: <strong>{line}</strong></> : "Pick or name a form to see what the AI will read."}
      </p>
      {showMove && (
        <fieldset className="form-move">
          <legend>Which facts are only true of {oldName}?</legend>
          <p className="meta">
            Ticked facts stay with {oldName} and aren&apos;t sent to the AI while {entry.name} is {name}. They count as {oldName} facts from where each was
            set, so earlier chapters don&apos;t change. Unticked facts stay true in every form.
          </p>
          {movable.map((f) => (
            <label key={f.fact_id} className={isTicked(f) ? "form-move-row on" : "form-move-row"}>
              <input type="checkbox" checked={isTicked(f)} onChange={(e) => setTicked({ ...ticked, [f.fact_id]: e.target.checked })} />
              <span>
                {f.aspect && <strong>{f.aspect}:</strong>} {f.text}
              </span>
              {inNewForm(f.aspect) ? (
                <small className="meta">{name} has its own</small>
              ) : (
                BODY_ASPECTS.some((a) => sameAspect(a, f.aspect)) && <small className="meta">often differs</small>
              )}
            </label>
          ))}
        </fieldset>
      )}
      {replAspects.length > 0 && <p className="meta" style={{ margin: 0 }}>What are they like as {name}? Optional: leave one empty to say nothing about it yet.</p>}
      {replAspects.map((a) => (
        <label key={a.toLowerCase()}>
          {a} as {name}
          <input aria-label={`${a} as ${name}`} value={replOf(a)} maxLength={FACT_LIMITS.text} onChange={(e) => setRepl({ ...repl, [a.toLowerCase()]: e.target.value })} />
        </label>
      ))}
      <ChapterSelect path={path} chapterId={chapterId} held={held} value={anchor} onChange={setAnchor} />
      <div className="row">
        <button
          type="button"
          disabled={busy || !name}
          onClick={save}
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
