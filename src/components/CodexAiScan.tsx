"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzePath, applyProposals, type PathChapter, type Proposal, type StoryInfo } from "@/lib/ai/codexAi";
import { ENTRY_TYPES, type CodexOp, type EntryType } from "@/lib/codex";
import { useSettings } from "@/lib/settings";

type Props = {
  story: StoryInfo;
  chapterId: string;
  path: PathChapter[];
  ops: CodexOp[];
  defaultOpen?: boolean;
};

type Row = Proposal & { accepted: boolean };

const LABEL = { create: "New entry", replace: "Change", retire: "Retire" } as const;

export default function CodexAiScan({ story, chapterId, path, ops, defaultOpen }: Props) {
  const router = useRouter();
  const settings = useSettings();
  const [scope, setScope] = useState<"chapter" | "path">("chapter");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanned, setScanned] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const current = path.find((c) => c.id === chapterId);

  async function scan() {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setScanning(true);
    setMessage(null);
    setRows([]);
    setScanned(false);
    try {
      await analyzePath(settings, {
        story,
        path,
        ops,
        scope,
        signal: ctl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
        onProposals: (ps) => setRows(ps.map((p) => ({ ...p, accepted: true }))),
      });
      setScanned(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
      setScanned(true);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function postAccepted() {
    const accepted = rows.filter((r) => r.accepted);
    setPosting(true);
    setMessage(null);
    let posted = 0;
    try {
      posted = await applyProposals(accepted, async (body) => {
        const res = await fetch("/api/codex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author_name: settings.authorName, ...body }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        return data.entry_id as string;
      });
      setRows([]);
      setScanned(false);
      setMessage({ ok: true, text: `Posted ${posted} codex change${posted === 1 ? "" : "s"}.` });
      router.refresh();
    } catch (e) {
      setMessage({
        ok: false,
        text: `${e instanceof Error ? e.message : String(e)}${posted > 0 ? ` (${posted} change${posted === 1 ? "" : "s"} were posted before it stopped.)` : ""}`,
      });
      router.refresh();
    } finally {
      setPosting(false);
    }
  }

  const acceptedCount = rows.filter((r) => r.accepted).length;

  return (
    <details className="ai-panel" open={defaultOpen}>
      <summary>
        <strong>AI codex helper</strong> <span className="meta">— suggest entries and changes from the story</span>
      </summary>

      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
        <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.25rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
            <input
              type="radio"
              name="scan-scope"
              checked={scope === "chapter"}
              onChange={() => setScope("chapter")}
              style={{ width: "auto" }}
            />
            Just this chapter{current ? ` (“${current.title}”)` : ""}
          </label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontWeight: 400 }}>
            <input
              type="radio"
              name="scan-scope"
              checked={scope === "path"}
              onChange={() => setScope("path")}
              style={{ width: "auto" }}
              disabled={path.length < 2}
            />
            Every chapter up to here ({path.length}; one AI call each, using your cheaper model)
          </label>
        </fieldset>

        <div className="row">
          <button type="button" onClick={scan} disabled={scanning || posting}>
            {scanning ? "Reading…" : "Scan for codex changes"}
          </button>
          {scanning && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
          {progress && progress.total > 1 && (
            <span className="meta">
              Chapter {Math.min(progress.done + 1, progress.total)} of {progress.total}
            </span>
          )}
        </div>

        {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
        {scanned && rows.length === 0 && !message && (
          <p className="meta">The AI found nothing to add or change.</p>
        )}

        {rows.map((r) => (
          <article key={r.key} className="card" style={{ opacity: r.accepted ? 1 : 0.55 }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={r.accepted}
                onChange={(e) => update(r.key, { accepted: e.target.checked })}
                style={{ width: "auto" }}
              />
              <span>
                <span className="tag">{LABEL[r.action]}</span> <strong>{r.name}</strong>{" "}
                <span className="meta">
                  {r.action !== "retire" && `[${r.type}] `}from “{r.anchorTitle}”
                </span>
              </span>
            </label>
            {r.reason && <p className="meta" style={{ margin: "0.25rem 0" }}>{r.reason}</p>}
            {r.action === "replace" && r.previous && (
              <div className="version">
                <span className="meta">Now:</span> {r.previous.content || <em>(no description)</em>}
              </div>
            )}
            {r.action !== "retire" && r.accepted && (
              <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                <div className="row">
                  <input
                    aria-label="Entry name"
                    value={r.name}
                    maxLength={100}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                  />
                  <select
                    aria-label="Entry type"
                    value={r.type}
                    style={{ width: "auto" }}
                    onChange={(e) => update(r.key, { type: e.target.value as EntryType })}
                  >
                    {ENTRY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  aria-label="Entry description"
                  style={{ minHeight: "5rem", fontFamily: "inherit" }}
                  value={r.content}
                  maxLength={8000}
                  onChange={(e) => update(r.key, { content: e.target.value })}
                />
              </div>
            )}
          </article>
        ))}

        {rows.length > 0 && (
          <div className="row">
            <button type="button" onClick={postAccepted} disabled={posting || scanning || acceptedCount === 0}>
              {posting ? "Posting…" : `Post ${acceptedCount} change${acceptedCount === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary" onClick={() => setRows([])} disabled={posting || scanning}>
              Discard
            </button>
            <span className="meta">Each change takes effect from the chapter it came from.</span>
          </div>
        )}
      </div>
    </details>
  );
}
