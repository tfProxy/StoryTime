"use client";

import { useEffect, useRef, useState } from "react";
import { draftRule, suggestTagsForChapter, type TagRule } from "@/lib/ai/tagAi";
import { saveSettings, useSettings } from "@/lib/settings";
import type { Tag, TagExample } from "@/lib/tags";
import AutoTextarea from "./AutoTextarea";

type StoryOption = { id: string; title: string; premise: string; root_chapter_id: string | null };

type Draft = {
  /** Set once the tag exists on the server. */
  id?: string;
  name: string;
  applies: string;
  not_applies: string;
  choices: string;
  examples: TagExample[];
  kind: "event" | "state";
  show_readers: boolean;
};

const EMPTY: Draft = { name: "", applies: "", not_applies: "", choices: "", examples: [], kind: "event", show_readers: false };

const fromTag = (t: Tag): Draft => ({
  id: t.id,
  name: t.name,
  applies: t.applies,
  not_applies: t.not_applies,
  choices: t.choices.join(", "),
  examples: t.examples,
  kind: t.kind,
  show_readers: t.show_readers,
});

const splitChoices = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);
const firstLine = (s: string) => s.trim().split("\n")[0];
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export default function TagLibrary() {
  const settings = useSettings();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [loadError, setLoadError] = useState("");
  // Which editor is open: a tag id, "new" (a tag not saved yet), or nothing.
  const [open, setOpen] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Draft | null>(null);

  useEffect(() => {
    api<{ tags: Tag[] }>("/api/tags", "GET")
      .then((r) => setTags(r.tags))
      .catch((e) => setLoadError(errText(e)));
  }, []);

  return (
    <section className="settings-section tag-library" aria-label="Tags">
      <h2>Tags</h2>
      <p className="meta">
        Tags label chapters (for example violence, tf). Switch them on per story on the story&apos;s Review page; the AI
        suggests them and you approve each one.
      </p>
      <label className="row" style={{ alignItems: "flex-start" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={settings.autoReview}
          onChange={(e) => void saveSettings({ ...settings, autoReview: e.target.checked })}
        />
        <span>
          Check new and edited chapters automatically
          <br />
          <span className="meta" style={{ fontWeight: "normal" }}>
            Finds tags, reads facts and checks continuity, and checks the summary, on the server with your cheaper
            model. Results wait on the Review page.
          </span>
        </span>
      </label>
      <label className="row" style={{ alignItems: "flex-start" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={settings.contentNotes}
          onChange={(e) => void saveSettings({ ...settings, contentNotes: e.target.checked })}
        />
        <span>
          Show content notes to readers
          <br />
          <span className="meta" style={{ fontWeight: "normal" }}>
            Under each choice, the tags marked Show to readers that come next or later on that branch.
          </span>
        </span>
      </label>
      {loadError &&<p className="error">{loadError}</p>}
      {tags === null && !loadError && <p className="meta">Loading…</p>}
      {tags?.length === 0 && !fresh && <p className="meta">No tags yet.</p>}

      {tags?.map((t) => (
        <article key={t.id} className="card" data-tag={t.name}>
          <button
            type="button"
            className="secondary"
            style={{ width: "100%", textAlign: "left" }}
            aria-expanded={open === t.id}
            onClick={() => setOpen(open === t.id ? null : t.id)}
          >
            <strong>{t.name}</strong>
            {firstLine(t.applies) && <span className="meta"> — {firstLine(t.applies)}</span>}
            {t.show_readers && <span className="meta"> · shown to readers</span>}
          </button>
          {open === t.id && (
            <TagEditor
              key={t.id}
              initial={fromTag(t)}
              onSaved={(saved) => setTags((ts) => ts && ts.map((x) => (x.id === saved.id ? saved : x)).sort(byName))}
              onDeleted={() => {
                setTags((ts) => ts && ts.filter((x) => x.id !== t.id));
                setOpen(null);
              }}
              onClose={() => setOpen(null)}
            />
          )}
        </article>
      ))}

      {fresh ? (
        <article className="card" data-tag="new">
          <h3 style={{ marginTop: 0 }}>New tag</h3>
          <TagEditor
            key={fresh.name + fresh.applies}
            initial={fresh}
            onSaved={(saved) => {
              setTags((ts) => [...(ts ?? []), saved].sort(byName));
              setFresh(null);
              setOpen(saved.id);
            }}
            onDeleted={() => setFresh(null)}
            onClose={() => setFresh(null)}
          />
        </article>
      ) : (
        <NewTagStart onStart={setFresh} />
      )}
    </section>
  );
}

const byName = (a: Tag, b: Tag) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

function NewTagStart({ onStart }: { onStart: (d: Draft) => void }) {
  const settings = useSettings();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const nameOf = () => (idea.includes(":") ? idea.split(":")[0].trim() : "");

  async function help() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setError("");
    try {
      const rule = await draftRule(settings, { idea, name: nameOf() || undefined, signal: ctl.signal });
      onStart({ ...EMPTY, name: rule.name, applies: rule.applies, not_applies: rule.not_applies, choices: rule.choices.join(", ") });
    } catch (e) {
      if (!isAbort(e)) setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <label htmlFor="tag-idea">New tag</label>
      <input
        id="tag-idea"
        value={idea}
        maxLength={500}
        placeholder="e.g. tf: a character changes species or physical form"
        onChange={(e) => setIdea(e.target.value)}
      />
      <div className="row">
        <button type="button" onClick={help} disabled={busy || !idea.trim()}>
          {busy ? "Writing…" : "Help me write it"}
        </button>
        {busy && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={() => onStart({ ...EMPTY, name: nameOf() })}>
          Write it myself
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

type Result = { title: string; found: { value: string | null; quote: string; reason: string } | null };

function TagEditor({
  initial,
  onSaved,
  onDeleted,
  onClose,
}: {
  initial: Draft;
  onSaved: (t: Tag) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setD((x) => ({ ...x, ...patch }));
  };

  const body = (examples: TagExample[]) => ({
    name: d.name.trim(),
    applies: d.applies,
    not_applies: d.not_applies,
    kind: d.kind,
    choices: splitChoices(d.choices),
    examples,
    show_readers: d.show_readers,
  });

  async function save() {
    setSaving(true);
    setError("");
    try {
      const t = d.id ? await api<Tag>(`/api/tags/${d.id}`, "PATCH", body(d.examples)) : await api<Tag>("/api/tags", "POST", body(d.examples));
      setSaved(true);
      setD((x) => ({ ...x, id: t.id }));
      onSaved(t);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeExample(i: number) {
    const examples = d.examples.filter((_, j) => j !== i);
    if (!d.id) return set({ examples });
    setError("");
    try {
      // Only the examples change; the other fields stay as they are on the server.
      const t = await api<Tag>(`/api/tags/${d.id}`, "PATCH", { examples });
      setD((x) => ({ ...x, examples: t.examples }));
      onSaved(t);
    } catch (e) {
      setError(errText(e));
    }
  }

  async function remove() {
    if (!d.id) return onDeleted();
    if (!window.confirm(`Delete the tag “${d.name}”?`)) return;
    try {
      await api(`/api/tags/${d.id}`, "DELETE");
      onDeleted();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
      <label>
        Name
        <input value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>
        Applies when
        <AutoTextarea
          value={d.applies}
          maxLength={2000}
          style={{ minHeight: "4rem", fontFamily: "inherit" }}
          onChange={(e) => set({ applies: e.target.value })}
        />
      </label>
      <label>
        Doesn&apos;t apply when
        <AutoTextarea
          value={d.not_applies}
          maxLength={2000}
          style={{ minHeight: "3rem", fontFamily: "inherit" }}
          onChange={(e) => set({ not_applies: e.target.value })}
        />
      </label>
      <label>
        Values
        <input value={d.choices} onChange={(e) => set({ choices: e.target.value })} />
        <span className="meta">Optional, e.g. mild, graphic. Separate them with commas.</span>
      </label>
      <label className="inline-label" style={{ padding: 0 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={d.show_readers} onChange={(e) => set({ show_readers: e.target.checked })} />
        <span>
          Show to readers
          <br />
          <span className="meta" style={{ fontWeight: "normal" }}>
            Readers see it in the notes under each choice (if content notes are on).
          </span>
        </span>
      </label>

      {d.examples.length > 0 && (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <strong>Examples</strong>
          {d.examples.map((ex, i) => (
            <div key={i} className="version">
              <span className="tag">{ex.applies ? "counts" : "doesn't count"}</span> {ex.text}
              {ex.note && <span className="meta"> ({ex.note})</span>}{" "}
              <button type="button" className="secondary" onClick={() => removeExample(i)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button type="button" onClick={save} disabled={saving || !d.name.trim()}>
          {saving ? "Saving…" : d.id ? "Save" : "Save tag"}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {d.id ? "Close" : "Cancel"}
        </button>
        {d.id && (
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        )}
        {saved && <span className="ok">Saved.</span>}
      </div>
      {error && <p className="error">{error}</p>}

      <TryIt draft={d} />
    </div>
  );
}

/** Runs the rule as it is in the editor (saved or not) on the first few chapters of a story. Saves nothing. */
function TryIt({ draft }: { draft: Draft }) {
  const settings = useSettings();
  const [stories, setStories] = useState<StoryOption[]>([]);
  const [storyId, setStoryId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api<StoryOption[]>("/api/stories", "GET")
      .then((s) => setStories(s.filter((x) => x.root_chapter_id)))
      .catch(() => {});
  }, []);

  async function run() {
    const story = stories.find((s) => s.id === storyId);
    if (!story?.root_chapter_id) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true);
    setError("");
    setResults([]);
    setDone(false);
    try {
      const rule: TagRule = {
        id: "draft",
        name: draft.name.trim() || "tag",
        applies: draft.applies,
        not_applies: draft.not_applies,
        choices: splitChoices(draft.choices),
        examples: draft.examples,
      };
      // Walk down from the first chapter, breadth first, to get up to five chapters with their text.
      const chapters: { id: string; title: string; body: string }[] = [];
      const queue = [story.root_chapter_id];
      while (queue.length && chapters.length < 5) {
        const id = queue.shift()!;
        const res = await api<{ chapter: { id: string; title: string; body: string }; choices: { child_chapter_id: string | null }[] }>(`/api/chapters/${id}`, "GET");
        chapters.push(res.chapter);
        for (const c of res.choices) if (c.child_chapter_id) queue.push(c.child_chapter_id);
      }
      for (let i = 0; i < chapters.length; i++) {
        setProgress({ n: i + 1, total: chapters.length });
        const ch = chapters[i];
        const found = await suggestTagsForChapter(settings, {
          story: { title: story.title, premise: story.premise },
          chapter: { title: ch.title, body: ch.body },
          tags: [rule],
          signal: ctl.signal,
        });
        const hit = found[0];
        setResults((r) => [...r, { title: ch.title, found: hit ? { value: hit.value, quote: hit.quote, reason: hit.reason } : null }]);
      }
      setDone(true);
    } catch (e) {
      if (!isAbort(e)) setError(errText(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem", borderTop: "1px solid var(--line)", paddingTop: "0.75rem" }}>
      <strong>Try it</strong>
      <span className="meta">Runs this rule, as written above, on the first chapters of a story. Nothing is saved.</span>
      <div className="row">
        <select aria-label="Story to try it on" value={storyId} onChange={(e) => setStoryId(e.target.value)} style={{ width: "auto", maxWidth: "100%" }}>
          <option value="">Choose a story…</option>
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={run} disabled={running || !storyId || !draft.applies.trim()}>
          {running ? "Reading…" : "Try it"}
        </button>
        {running && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
        {progress && (
          <span className="meta">
            Chapter {progress.n} of {progress.total}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {results.map((r, i) => (
        <div key={i} className="version">
          <strong>{r.title}</strong>:{" "}
          {r.found ? (
            <>
              tagged{r.found.value ? ` (${r.found.value})` : ""}
              {r.found.quote && <blockquote style={{ margin: "0.25rem 0" }}>“{r.found.quote}”</blockquote>}
              {r.found.reason && <span className="meta">{r.found.reason}</span>}
            </>
          ) : (
            <span className="meta">not tagged</span>
          )}
        </div>
      ))}
      {done && results.length === 0 && <p className="meta">That story has no chapters to read.</p>}
    </div>
  );
}
