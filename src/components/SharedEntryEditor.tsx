"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeSharedFacts, ENTRY_TYPES, STARTER_ASPECTS, TYPE_LABELS, type EntryType } from "@/lib/codex";
import type { SharedEntry } from "@/lib/sharedCodex";

const keywordsOf = (text: string) => text.split(",").map((a) => a.trim()).filter(Boolean);

type Usage = { story_id: string; title: string; links: number }[];

/**
 * A shared entry's base: its details, notes and facts. Everything saved here changes the entry in every story that
 * links to it (a story can still change a field or a fact for itself, from its own copy of the entry).
 */
export default function SharedEntryEditor({ entry, usedIn }: { entry: SharedEntry; usedIn: Usage }) {
  const router = useRouter();
  const [name, setName] = useState(entry.name);
  const [type, setType] = useState<EntryType>(entry.type);
  const [aliases, setAliases] = useState(entry.aliases.join(", "));
  const [always, setAlways] = useState(entry.always_include);
  const [content, setContent] = useState(entry.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    name.trim() !== entry.name ||
    type !== entry.type ||
    always !== entry.always_include ||
    content.trim() !== entry.content ||
    keywordsOf(aliases).join("\n") !== entry.aliases.join("\n");

  /** Sends one request and refreshes the page; returns whether it worked. */
  async function send(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const ok = await send("PATCH", `/api/shared/${entry.id}`, { name: name.trim(), type, aliases: keywordsOf(aliases), always_include: always, content: content.trim() });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${entry.name}” from the shared codex?`)) return;
    if (await send("DELETE", `/api/shared/${entry.id}`)) router.push("/shared");
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {error && <p className="error">{error}</p>}
      <p className="notice">
        This is the base entry. Changes you save here appear in <strong>every story</strong> that uses it
        {usedIn.length > 0 ? ` (${usedIn.length})` : ""}. A story can still change a fact for itself; that change stays in that story.
      </p>

      <section className="entry-section">
        <h2>Details</h2>
        <form
          className="fact-form entry-details-form flat"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Name
            <input required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as EntryType)}>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Keywords
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
            <small>comma-separated; words in the story that bring this entry into the AI&apos;s prompt</small>
          </label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: "auto" }} />
            <span>
              Always include in AI prompts <small>(otherwise only when a keyword or the name appears nearby)</small>
            </span>
          </label>
          <label>
            Your notes (not sent to the AI)
            <textarea rows={4} style={{ minHeight: "7rem" }} value={content} maxLength={8000} onChange={(e) => setContent(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit" disabled={busy || !name.trim() || !dirty}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {saved && !dirty && (
              <span className="ok" role="status">
                Saved
              </span>
            )}
          </div>
        </form>
      </section>

      <SharedFacts entry={entry} busy={busy} send={send} />

      <section className="entry-section">
        <h2>What the AI reads</h2>
        <div className="fact-ai">{describeSharedFacts(entry.facts) || <em>Nothing yet — add facts. Notes are not sent to the AI.</em>}</div>
        <p className="meta">This is the shared entry on its own. A story that uses it can change or add facts, so what the AI reads there may differ.</p>
      </section>

      <section className="entry-section">
        <h2>Used in</h2>
        {usedIn.length === 0 ? (
          <p className="meta">No story uses this entry yet. Add it from a story&apos;s codex page with “+ Shared entry”.</p>
        ) : (
          <ul>
            {usedIn.map((s) => (
              <li key={s.story_id}>
                <Link href={`/s/${s.story_id}/details`}>{s.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="entry-section">
        <h2>Delete</h2>
        <p className="meta">
          {usedIn.length > 0 ? "An entry that stories use can't be deleted. Remove it from those stories first." : "Removes the entry and its facts from the shared codex."}
        </p>
        <div>
          <button type="button" className="secondary" disabled={busy || usedIn.length > 0} onClick={remove}>
            Delete {TYPE_LABELS[entry.type].toLowerCase()}
          </button>
        </div>
      </section>
    </div>
  );
}

function SharedFacts({ entry, busy, send }: { entry: SharedEntry; busy: boolean; send: (method: string, url: string, body?: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [aspect, setAspect] = useState("");
  const [form, setForm] = useState("");
  const [text, setText] = useState("");
  const base = `/api/shared/${entry.id}/facts`;

  function open(id: string | "new", f?: SharedEntry["facts"][number]) {
    setEditing(id);
    setAspect(f?.aspect ?? "");
    setForm(f?.form ?? "");
    setText(f?.text ?? "");
  }
  async function submit() {
    const body = { aspect: aspect.trim(), form: form.trim(), text: text.trim() };
    const ok = editing === "new" ? await send("POST", base, body) : await send("PUT", `${base}/${editing}`, body);
    if (ok) setEditing(null);
  }
  const form_ = (
    <form
      className="fact-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Aspect
        <input list="shared-aspects" value={aspect} maxLength={40} onChange={(e) => setAspect(e.target.value)} />
        <datalist id="shared-aspects">
          {STARTER_ASPECTS[entry.type].map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <small>what it describes (“Ears”); leave empty for a loose fact. “form” sets the form the entry is in.</small>
      </label>
      <label>
        Form
        <input value={form} maxLength={40} onChange={(e) => setForm(e.target.value)} />
        <small>only applies while the entry is in this form; empty for every form</small>
      </label>
      <label>
        Text
        <textarea rows={2} style={{ minHeight: "4rem" }} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" disabled={busy || (!text.trim() && !(aspect.trim().toLowerCase() === "form" && form.trim()))}>
          {busy ? "Saving…" : "Save fact"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(null)}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <section className="entry-section">
      <h2>Facts</h2>
      {entry.facts.length === 0 && editing !== "new" && <p className="meta">No facts yet. Facts are what the AI reads about the entry.</p>}
      <ul className="fact-list">
        {entry.facts.map((f) => (
          <li key={f.id}>
            {editing === f.id ? (
              form_
            ) : (
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <span>
                  <strong>{f.aspect || "Fact"}</strong>
                  {f.form && <span className="meta"> ({f.form})</span>}: {f.text}
                </span>
                <span className="row">
                  <button type="button" className="secondary" disabled={busy} onClick={() => open(f.id, f)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Remove this fact from the shared entry? Stories that changed it lose their change too.")) void send("DELETE", `${base}/${f.id}`);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        form_
      ) : (
        <div>
          <button type="button" className="secondary" disabled={busy} onClick={() => open("new")}>
            + Add fact
          </button>
        </div>
      )}
    </section>
  );
}
