"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { suggestTagsForChapter, type TagRule } from "@/lib/ai/tagAi";
import { useSettings } from "@/lib/settings";

export type ScanChapter = {
  id: string;
  title: string;
  body: string;
  revision: number;
  /** The chapter this one continues from; null for the first chapter. */
  parent_id: string | null;
  /** Tag ids already decided for this revision (approved, or rejected at this revision). */
  decided: string[];
};

type Props = {
  story: { title: string; premise: string };
  /** Every chapter, parents first. */
  chapters: ScanChapter[];
  /** The chapter named by ?chapter=, if any. */
  chapterId?: string;
  tags: TagRule[];
};

export default function TagScan({ story, chapters, chapterId, tags }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [scope, setScope] = useState<Scope>(chapterId ? "chapter" : "story");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const current = chapters.find((c) => c.id === chapterId);
  const wayHere = current ? pathTo(chapters, current.id) : [];
  const fromHere = current ? subtreeOf(chapters, current.id) : [];
  const counted = (n: number) => `${n} chapter${n === 1 ? "" : "s"}`;

  async function scan() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setScanning(true);
    setMessage(null);
    const chosen = !current || scope === "story" ? chapters : scope === "path" ? wayHere : scope === "subtree" ? fromHere : [current];
    const ids = tags.map((t) => t.id);
    const todo = chosen.filter((c) => !ids.every((id) => c.decided.includes(id)));
    const skipped = chosen.length - todo.length;
    let found = 0;
    let done = 0;
    let failure: string | null = null;
    setProgress({ done: 0, total: todo.length });
    try {
      for (const c of todo) {
        const suggestions = await suggestTagsForChapter(settings, {
          story,
          chapter: { title: c.title, body: c.body },
          tags,
          signal: ctl.signal,
          role: scope === "chapter" && current ? "main" : "cheap",
        });
        const res = await fetch(`/api/chapters/${c.id}/tags/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: c.revision, checked_tag_ids: ids, suggestions }),
        });
        const data = await res.json().catch(() => ({}));
        // A chapter edited meanwhile is skipped; the next run will read it again.
        if (!res.ok && res.status !== 409) throw new Error(data.error ?? `Request failed (${res.status})`);
        if (res.ok) found += data.added ?? 0;
        done++;
        setProgress({ done, total: todo.length });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) failure = e instanceof Error ? e.message : String(e);
    } finally {
      setScanning(false);
      setProgress(null);
    }
    const skippedText = skipped > 0 ? ` ${skipped} chapter${skipped === 1 ? " was" : "s were"} skipped (already decided).` : "";
    if (failure) setMessage({ ok: false, text: `${failure} (${done} of ${todo.length} chapters were read.)${skippedText}` });
    else setMessage({ ok: true, text: `Read ${done} chapter${done === 1 ? "" : "s"}; found ${found} new suggestion${found === 1 ? "" : "s"}.${skippedText}` });
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.25rem" }}>
        {chapterId && current && (
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
            <input type="radio" name="tag-scope" checked={scope === "chapter"} onChange={() => setScope("chapter")} style={{ width: "auto" }} />
            This chapter (“{current.title}”)
          </label>
        )}
        {current && wayHere.length > 1 && (
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
            <input type="radio" name="tag-scope" checked={scope === "path"} onChange={() => setScope("path")} style={{ width: "auto" }} />
            The way here ({counted(wayHere.length)}, from the first chapter to this one)
          </label>
        )}
        {current && fromHere.length > 1 && (
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
            <input type="radio" name="tag-scope" checked={scope === "subtree"} onChange={() => setScope("subtree")} style={{ width: "auto" }} />
            From here on ({counted(fromHere.length)}, this one and every chapter after it)
          </label>
        )}
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
          <input type="radio" name="tag-scope" checked={scope === "story"} onChange={() => setScope("story")} style={{ width: "auto" }} />
          The whole story ({counted(chapters.length)})
        </label>
      </fieldset>
      {scope !== "chapter" && <p className="meta">One AI call per chapter, using your cheaper model.</p>}
      <div className="row">
        <button type="button" onClick={scan} disabled={scanning}>
          {scanning ? "Reading…" : "Find tags"}
        </button>
        {scanning && (
          <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
        {progress && progress.total > 0 && (
          <span className="meta">
            Chapter {Math.min(progress.done + 1, progress.total)} of {progress.total}
          </span>
        )}
      </div>
      {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
    </div>
  );
}

type Scope = "chapter" | "path" | "subtree" | "story";

/** The chapters from the first one down to `id`, in reading order. */
function pathTo(chapters: ScanChapter[], id: string): ScanChapter[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const out: ScanChapter[] = [];
  for (let c = byId.get(id); c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c);
  return out;
}

/** `id` and every chapter below it, parents first (the input is parents first). */
function subtreeOf(chapters: ScanChapter[], id: string): ScanChapter[] {
  const inside = new Set([id]);
  return chapters.filter((c) => {
    if (c.id === id || (c.parent_id && inside.has(c.parent_id))) {
      inside.add(c.id);
      return true;
    }
    return false;
  });
}
