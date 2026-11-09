"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RetconChangeView, RetconView } from "@/lib/retcons";
import type { RetconEdit } from "@/lib/retconText";
import { wordDiff } from "@/lib/wordDiff";
import AiRunProgress from "./AiRunProgress";

const STATUS: Record<RetconChangeView["status"], string> = { open: "", applied: "Changed", skipped: "Left as it was", undone: "Put back" };

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The request failed (${res.status})`);
  return data;
}

function Diff({ edit }: { edit: RetconEdit }) {
  return (
    <p className="inbox-diff retcon-diff" aria-label="What changes">
      {wordDiff(edit.old, edit.new).map((seg, i) =>
        seg.type === "add" ? <ins key={i}>{seg.text}</ins> : seg.type === "del" ? <del key={i}>{seg.text}</del> : <span key={i}>{seg.text}</span>,
      )}
    </p>
  );
}

/** One chapter's proposed change: each passage as a diff, which can be left out or reworded, then Accept or Skip. */
function ChangeCard({ change, live, onDone }: { change: RetconChangeView; live: boolean; onDone: () => void }) {
  const [texts, setTexts] = useState(change.edits.map((e) => e.new));
  const [kept, setKept] = useState(change.edits.map(() => true));
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = change.status === "open" && live;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const edits = change.edits.map((e, i) => ({ old: e.old, new: texts[i] })).filter((_, i) => kept[i]);
  return (
    <li className={`retcon-change retcon-change-${change.status}`}>
      <div className="retcon-change-head">
        <Link href={`/c/${change.chapter_id}`}>{change.chapter_title}</Link>
        {STATUS[change.status] && <span className="meta"> · {STATUS[change.status]}</span>}
      </div>
      {change.edits.length > 0 && (
        <ol className="retcon-edits">
          {change.edits.map((e, i) => (
            <li key={i} className={kept[i] ? "" : "retcon-edit-off"}>
              <Diff edit={{ old: e.old, new: texts[i] }} />
              {open && (
                <div className="row retcon-edit-actions">
                  <label className="retcon-check">
                    <input type="checkbox" checked={kept[i]} onChange={(ev) => setKept(kept.map((k, j) => (j === i ? ev.target.checked : k)))} /> Change this
                  </label>
                  <button type="button" className="linkish" onClick={() => setEditing(editing === i ? null : i)} aria-expanded={editing === i}>
                    Reword
                  </button>
                </div>
              )}
              {open && editing === i && (
                <textarea
                  aria-label="New text"
                  value={texts[i]}
                  rows={3}
                  onChange={(ev) => setTexts(texts.map((t, j) => (j === i ? ev.target.value : t)))}
                  style={{ fontFamily: "inherit", width: "100%" }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {change.note && <p className="retcon-note">AI: {change.note}</p>}
      {change.status === "open" && change.edited_since && <p className="meta">The chapter was edited after the AI read it; a passage that is gone can&apos;t be changed.</p>}
      {change.status === "applied" && change.edited_since && <p className="meta">Edited again since. Undo leaves this chapter as it is.</p>}
      {change.has_pictures && change.status !== "skipped" && change.edits.length > 0 && <p className="meta">This chapter has pictures, which may show the old version.</p>}
      {open && (
        <div className="row">
          {change.edits.length > 0 && (
            <button type="button" disabled={busy || edits.length === 0} onClick={() => void act(() => post(`/api/retcon-changes/${change.id}/apply`, { edits }))}>
              Accept
            </button>
          )}
          <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => post(`/api/retcon-changes/${change.id}/skip`))}>
            {change.edits.length > 0 ? "Skip" : "Done"}
          </button>
        </div>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

function RetconCard({ retcon, running }: { retcon: RetconView; running: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const live = retcon.undone_at === null;
  const open = retcon.changes.filter((c) => c.status === "open");
  const toAccept = open.filter((c) => c.edits.length > 0).length;
  const applied = retcon.changes.filter((c) => c.status === "applied").length;
  const refresh = () => router.refresh();

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const acceptAll = () =>
    act(async () => {
      const r = (await post(`/api/retcons/${retcon.id}/apply-all`)) as { applied: number; failed: string[] };
      return `Changed ${r.applied} chapter${r.applied === 1 ? "" : "s"}.${r.failed.length ? ` Not changed (edited since): ${r.failed.join(", ")}.` : ""}`;
    });
  const undo = () => {
    if (!window.confirm(`Undo the retcon “${retcon.title}”? Changed chapters get their old text back${retcon.kind === "codex" ? " and the codex fact is put back" : ""}.`)) return;
    void act(async () => {
      const r = (await post(`/api/retcons/${retcon.id}/undo`)) as { restored: number; kept: string[] };
      return `Undone. ${r.restored} chapter${r.restored === 1 ? "" : "s"} put back.${r.kept.length ? ` Edited since, so left as they are: ${r.kept.join(", ")}.` : ""}`;
    });
  };

  return (
    <article className="card retcon-card" id={`retcon-${retcon.id}`} aria-label={`Retcon ${retcon.title}`}>
      <h3>{retcon.title}</h3>
      <p className="meta">
        From <Link href={`/c/${retcon.chapter_id}`}>“{retcon.chapter_title}”</Link> · {new Date(retcon.created_at).toLocaleString()}
        {!live && " · undone"}
      </p>
      <p className="retcon-instruction">{retcon.instruction}</p>
      {live && running && retcon.run_id && <AiRunProgress key={retcon.run_id} runId={retcon.run_id} onFinished={refresh} />}
      {!running && (
        <p className="meta">
          {retcon.reads === 0
            ? "No chapter needed reading."
            : `Read ${retcon.reads === 1 ? "1 chapter" : `${retcon.reads} chapters`}: ${retcon.changes.filter((c) => c.edits.length > 0).length} with passages to change.`}
          {applied > 0 && ` ${applied} changed.`}
        </p>
      )}
      {retcon.changes.length > 0 && (
        <ol className="retcon-changes">
          {retcon.changes.map((c) => (
            <ChangeCard key={`${c.id}-${c.status}`} change={c} live={live} onDone={refresh} />
          ))}
        </ol>
      )}
      {live && (
        <div className="row">
          {toAccept > 1 && (
            <button type="button" disabled={busy} onClick={() => void acceptAll()}>
              Accept all ({toAccept})
            </button>
          )}
          <button type="button" className="secondary" disabled={busy} onClick={undo}>
            Undo this retcon
          </button>
        </div>
      )}
      {message && (
        <p className={message.ok ? "ok" : "error"} role="status">
          {message.text}
        </p>
      )}
    </article>
  );
}

/** The story's retcons, newest first. `running`: the ids of runs still going. */
export default function RetconList({ retcons, running }: { retcons: RetconView[]; running: string[] }) {
  if (retcons.length === 0) return <p className="meta">No retcons yet.</p>;
  return (
    <div className="retcon-list">
      {retcons.map((r) => (
        <RetconCard key={r.id} retcon={r} running={!!r.run_id && running.includes(r.run_id)} />
      ))}
    </div>
  );
}
