"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { splitParagraphs } from "@/lib/imageSlots";
import { wordDiff } from "@/lib/wordDiff";
import { cleanForm, isFormAspect } from "@/lib/codex";
import type { CodexSuggestion } from "@/lib/codexSuggestions";
import { acceptableInBulk, INBOX_CHANGED, SourceBadge, suggestionSource, useCodexInbox } from "./CodexInbox";

/** A fact the AI applied on its own at this chapter, not yet approved. */
export type AppliedFact = { op_id: string; entry_id: string; entry_name: string; aspect: string; form: string; text: string; quote: string };

type Item = { key: string; quote: string; entryId: string | null } & ({ kind: "suggestion"; s: CodexSuggestion } | { kind: "fact"; f: AppliedFact });
type Placed = { item: Item; para: number; start: number; end: number };

/**
 * Where a quote is in a paragraph: its words in order, with any spacing or punctuation between them, ignoring case and
 * the kind of apostrophe (the AI's quotes were checked against the text the same loose way).
 */
function findQuote(quote: string, paragraphs: string[]): { para: number; start: number; end: number } | null {
  const words = quote.replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu);
  if (!words?.length) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’‘]")).join("[^\\p{L}\\p{N}]+"), "iu");
  for (let i = 0; i < paragraphs.length; i++) {
    const m = re.exec(paragraphs[i]);
    if (m) return { para: i, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
}

const domId = (key: string) => key; // "s-<suggestion id>" or "f-<fact op id>"

/**
 * The AI's codex changes from one chapter, beside the chapter's text: each quoted sentence is highlighted, and the
 * change it backs sits in the margin of its paragraph (under it on a phone). Tapping one selects the other. Changes
 * whose quote isn't in this chapter (Flesh out quoting an earlier one) are listed above the text.
 */
export default function CodexReview({
  storyId,
  chapterId,
  title,
  body,
  applied,
  entryId,
}: {
  storyId: string;
  chapterId: string;
  title: string;
  body: string;
  applied: AppliedFact[];
  entryId: string | null;
}) {
  const router = useRouter();
  const live = useCodexInbox({ storyId, chapterId });
  const [sel, setSel] = useState<string | null>(null);
  const [factState, setFactState] = useState<Record<string, "approved" | "undone" | "busy">>({});
  const [factError, setFactError] = useState("");
  const paragraphs = useMemo(() => splitParagraphs(body).map((p) => p.trim()), [body]);

  // A link to one change ("#s-<id>", from an entry's page) selects it once the list is in.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (!h) return;
    const t = setTimeout(() => setSel(h), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (sel && live.items) document.getElementById(domId(sel))?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [sel, live.items]);

  // Text-based changes only: an AI idea (Flesh out without a quote) or one from the entry's notes has no sentence
  // here and is decided on the entry's page.
  const elsewhere = (s: CodexSuggestion) => s.source === "notes" || (s.source === "expand" && !s.quote);
  const forEntry = (id: string | null) => entryId === null || id === entryId;
  const suggestions = live.shown.filter((s) => !elsewhere(s) && forEntry(s.kind === "entry" ? null : s.entry_id) && (entryId === null || s.kind !== "entry"));
  const ideas = live.shown.filter((s) => s.status === "open" && elsewhere(s) && forEntry(s.entry_id));
  const facts = applied.filter((f) => forEntry(f.entry_id));

  const items: Item[] = [
    ...facts.map((f) => ({ key: `f-${f.op_id}`, quote: f.quote, entryId: f.entry_id, kind: "fact" as const, f })),
    ...suggestions.map((s) => ({ key: `s-${s.id}`, quote: s.quote, entryId: s.entry_id, kind: "suggestion" as const, s })),
  ];
  const placed: Placed[] = [];
  const unplaced: Item[] = [];
  for (const item of items) {
    const at = item.quote ? findQuote(item.quote, paragraphs) : null;
    if (at) placed.push({ item, ...at });
    else unplaced.push(item);
  }

  const entries = new Map<string, string>();
  for (const s of live.shown) if (s.entry_id && !elsewhere(s)) entries.set(s.entry_id, s.entry_name);
  for (const f of applied) entries.set(f.entry_id, f.entry_name);

  const open = suggestions.filter((s) => s.status === "open").length + facts.filter((f) => !factState[f.op_id] || factState[f.op_id] === "busy").length;
  const bulk = suggestions.filter(acceptableInBulk);

  async function decideFact(f: AppliedFact, action: "approve" | "undo-ai") {
    setFactState((m) => ({ ...m, [f.op_id]: "busy" }));
    setFactError("");
    try {
      await post(`/api/codex/${action}`, { ids: [f.op_id] });
      setFactState((m) => ({ ...m, [f.op_id]: action === "approve" ? "approved" : "undone" }));
      // An undo dismisses the suggestion behind the fact.
      if (action === "undo-ai") window.dispatchEvent(new Event(INBOX_CHANGED));
    } catch (e) {
      setFactState((m) => {
        const next = { ...m };
        delete next[f.op_id];
        return next;
      });
      setFactError(e instanceof Error ? e.message : String(e));
    }
  }

  const card = (item: Item) =>
    item.kind === "fact" ? (
      <FactCard key={item.key} f={item.f} state={factState[item.f.op_id]} selected={sel === item.key} onSelect={() => setSel(item.key)} onDecide={(a) => void decideFact(item.f, a)} />
    ) : (
      <SuggestionCard
        key={item.key}
        s={item.s}
        selected={sel === item.key}
        onSelect={() => setSel(item.key)}
        busy={live.busy.has(item.s.id)}
        error={live.errors[item.s.id]}
        editing={live.editing === item.s.id}
        onEdit={(on) => live.setEditing(on ? item.s.id : null)}
        onAccept={(edits) => void live.accept(item.s, edits)}
        onDismiss={() => void live.dismiss(item.s)}
        onReopen={() => void live.reopen(item.s)}
      />
    );

  /** A paragraph with its quoted sentences as buttons that select their change. */
  const paragraph = (text: string, i: number) => {
    const marks = placed.filter((p) => p.para === i).sort((a, b) => a.start - b.start);
    const out: React.ReactNode[] = [];
    let pos = 0;
    for (const m of marks) {
      if (m.start < pos) continue; // overlaps an earlier one: its change still sits in this margin
      out.push(text.slice(pos, m.start));
      out.push(
        <button
          key={m.item.key}
          type="button"
          className={`cr-mark${sel === m.item.key ? " cr-selected" : ""}`}
          data-for={m.item.key}
          onClick={() => setSel(m.item.key)}
          aria-label={`Show the change this backs: ${text.slice(m.start, m.end)}`}
        >
          {text.slice(m.start, m.end)}
        </button>,
      );
      pos = m.end;
    }
    out.push(text.slice(pos));
    return out;
  };

  return (
    <div className="codex-review-page">
      <div className="cr-bar">
        <Link href={`/c/${chapterId}`}>← “{title}”</Link>
        <h1 className="cr-title">
          Codex changes from “{title}”{entryId && entries.get(entryId) ? ` for ${entries.get(entryId)}` : ""}
        </h1>
        <span className="meta">{live.items === null ? "Reading…" : open === 0 ? "nothing waiting" : `${open} waiting`}</span>
        {entries.size > 1 || entryId ? (
          <label className="cr-filter">
            <span className="meta">Show</span>
            <select value={entryId ?? ""} onChange={(e) => router.replace(`/c/${chapterId}/codex-review${e.target.value ? `?entry=${encodeURIComponent(e.target.value)}` : ""}`)}>
              <option value="">Everyone</option>
              {[...entries].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {bulk.length > 1 && (
          <button type="button" className="secondary" disabled={bulk.some((s) => live.busy.has(s.id))} onClick={() => void live.acceptAll(bulk)}>
            Accept the {bulk.length} the text shows
          </button>
        )}
        <Link className="button" href={`/c/${chapterId}`}>
          Done
        </Link>
      </div>

      {live.loadError && <p className="error">{live.loadError}</p>}
      {factError && <p className="error">{factError}</p>}
      {live.items !== null && items.length === 0 && <p className="meta">Nothing waiting from this chapter.</p>}

      {ideas.length > 0 && (
        <p className="notice">
          {ideas.length === 1 ? "1 AI idea" : `${ideas.length} AI ideas`} with no sentence in the story wait on{" "}
          {[...new Map(ideas.map((s) => [s.entry_id, s.entry_name])).entries()].map(([id, name], i) => (
            <Fragment key={id}>
              {i > 0 && ", "}
              <Link href={`/s/${storyId}/codex/${id}?at=${chapterId}`}>{name}&apos;s page</Link>
            </Fragment>
          ))}
          .
        </p>
      )}

      {unplaced.length > 0 && (
        <section className="cr-unplaced" aria-label="Not quoted from this chapter">
          <h2>Not quoted from this chapter</h2>
          <p className="meta">The AI&apos;s sentence for these is from an earlier chapter, or couldn&apos;t be found in this one.</p>
          <div className="cr-cards">{unplaced.map(card)}</div>
        </section>
      )}

      <div className="cr-text">
        {paragraphs.map((p, i) => {
          const here = placed.filter((x) => x.para === i);
          return (
            <div key={i} className={`cr-row${here.length ? " cr-has" : ""}`}>
              <p className="cr-para">{paragraph(p, i)}</p>
              {here.length > 0 && <div className="cr-margin">{here.map((x) => card(x.item))}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function head(s: CodexSuggestion) {
  if (s.kind === "entry") return `New ${s.entry?.type ?? "entry"}: ${s.entry_name}`;
  const aspect = s.kind === "form" ? "Form" : s.aspect || "General";
  const form = s.kind !== "form" && cleanForm(s.form) ? ` (${cleanForm(s.form)})` : "";
  return `${s.entry_name || "An entry"} · ${aspect}${form}`;
}

const afterText = (s: CodexSuggestion) => (s.kind === "form" ? [s.form, s.after].filter(Boolean).join(", ") : s.after);

function SuggestionCard({
  s,
  selected,
  onSelect,
  busy,
  error,
  editing,
  onEdit,
  onAccept,
  onDismiss,
  onReopen,
}: {
  s: CodexSuggestion;
  selected: boolean;
  onSelect: () => void;
  busy: boolean;
  error?: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onAccept: (edits?: { aspect?: string; form?: string; text?: string }) => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const [aspect, setAspect] = useState(s.kind === "form" ? s.form : s.aspect);
  const [text, setText] = useState(s.after);
  const id = `s-${s.id}`;

  if (s.status !== "open") {
    return (
      <div id={id} className="cr-card cr-done">
        <span>
          {s.status === "accepted" ? "Saved" : "Dismissed"}: <strong>{head(s)}</strong>
        </span>
        {s.status === "dismissed" && (
          <button type="button" className="secondary" disabled={busy} onClick={onReopen}>
            Undo
          </button>
        )}
        {error && <span className="error">{error}</span>}
      </div>
    );
  }

  const tone = suggestionSource(s).tone;
  const conflict = s.kind === "conflict";
  const segments = s.kind === "entry" || conflict ? [] : wordDiff(s.before, s.kind === "retire" ? "" : afterText(s));
  return (
    <article id={id} className={`cr-card cr-tone-${tone}${selected ? " cr-selected" : ""}`}>
      <div className="cr-card-head">
        <button type="button" className="cr-card-title" onClick={onSelect} aria-label={`${head(s)}: show its sentence`}>
          {head(s)}
        </button>
        <SourceBadge s={s} />
      </div>
      {s.kind === "entry" ? (
        s.entry?.notes && <p className="cr-card-text">{s.entry.notes}</p>
      ) : conflict ? (
        <p className="cr-card-text">
          Codex: <strong>{s.before || "nothing"}</strong> · here: <strong>{s.after}</strong>
        </p>
      ) : editing ? (
        <div className="inbox-edit">
          <label>
            <span className="meta">{s.kind === "form" ? "Form" : "Aspect"}</span>
            <input value={aspect} maxLength={100} onChange={(e) => setAspect(e.target.value)} />
          </label>
          <label>
            <span className="meta">{s.kind === "form" ? "Note" : "Fact"}</span>
            <textarea value={text} rows={3} maxLength={2000} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit" }} />
          </label>
        </div>
      ) : (
        <p className="cr-card-text inbox-diff">
          {segments.map((seg, i) => (seg.type === "add" ? <ins key={i}>{seg.text}</ins> : seg.type === "del" ? <del key={i}>{seg.text}</del> : <span key={i}>{seg.text}</span>))}
        </p>
      )}
      {tone === "unsure" && <p className="inbox-unsure">The highlighted sentence doesn&apos;t mention this. Read it before accepting.</p>}
      {s.kind !== "entry" && s.current !== s.before && !conflict && (
        <p className="meta" style={{ margin: 0 }}>
          The codex has changed since: now {s.current ? `“${s.current}”` : "empty"}
        </p>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="inbox-actions">
        {editing ? (
          <>
            <button type="button" disabled={busy || !text.trim()} onClick={() => onAccept(s.kind === "form" ? { form: aspect, text } : { aspect, text })}>
              Save
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => onEdit(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => onAccept()}>
              {s.kind === "entry" ? "Add it" : conflict ? `Make it ${s.after}` : "Accept"}
            </button>
            {(s.kind === "set" || s.kind === "form") && (
              <button type="button" className="secondary" disabled={busy} onClick={() => onEdit(true)}>
                Edit
              </button>
            )}
            <button type="button" className="secondary" disabled={busy} onClick={onDismiss}>
              {conflict ? `Keep ${s.before || "the codex"}` : "Dismiss"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function FactCard({
  f,
  state,
  selected,
  onSelect,
  onDecide,
}: {
  f: AppliedFact;
  state?: "approved" | "undone" | "busy";
  selected: boolean;
  onSelect: () => void;
  onDecide: (action: "approve" | "undo-ai") => void;
}) {
  const id = `f-${f.op_id}`;
  const what = `${f.entry_name} · ${isFormAspect(f.aspect) ? "Form" : f.aspect || "General"}${!isFormAspect(f.aspect) && f.form ? ` (${f.form})` : ""}`;
  if (state === "approved" || state === "undone") {
    return (
      <div id={id} className="cr-card cr-done">
        <span>
          {state === "approved" ? "Approved" : "Undone"}: <strong>{what}</strong>
        </span>
      </div>
    );
  }
  return (
    <article id={id} className={`cr-card cr-applied${selected ? " cr-selected" : ""}`}>
      <div className="cr-card-head">
        <button type="button" className="cr-card-title" onClick={onSelect} aria-label={`${what}: show its sentence`}>
          {what}
        </button>
        <span className="source-badge source-invented">Already applied by the AI</span>
      </div>
      <p className="cr-card-text">{isFormAspect(f.aspect) ? [f.form, f.text].filter(Boolean).join(", ") : f.text}</p>
      <div className="inbox-actions">
        <button type="button" disabled={state === "busy"} onClick={() => onDecide("approve")}>
          Approve
        </button>
        <button type="button" className="secondary" disabled={state === "busy"} onClick={() => onDecide("undo-ai")}>
          Undo
        </button>
      </div>
    </article>
  );
}
