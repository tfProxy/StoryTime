"use client";

import { useEffect, useRef, useState } from "react";
import type { FactMove } from "@/lib/codexFactMove";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const chLabel = (o: { number: number; title: string }) => `Ch. ${o.number} “${o.title}”`;

/**
 * "Move to an earlier chapter…" from a fact's ⋯ on the entry's page: a dialog listing the chapters back along this
 * line, each with whether the fact can move there; Move re-dates the change that sets it (see codexFactMove.ts).
 */
export default function FactMover({
  entryId,
  factOpId,
  chapterId,
  onMoved,
  onClose,
}: {
  entryId: string;
  /** The change that sets the fact, as the page shows it. */
  factOpId: string;
  /** The chapter the page shows the entry at. */
  chapterId: string;
  onMoved: () => void;
  onClose: () => void;
}) {
  const [move, setMove] = useState<FactMove | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ entry_id: entryId, fact_op_id: factOpId, chapter_id: chapterId });
    fetch(`/api/codex/move-fact?${q}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!live) return;
        if (r.ok) setMove(json as FactMove);
        else setError((json as { error?: string } | null)?.error ?? "The chapters could not be loaded.");
      })
      .catch(() => live && setError("The chapters could not be loaded. Check the connection and try again."));
    return () => {
      live = false;
    };
  }, [entryId, factOpId, chapterId]);

  const option = move?.options.find((o) => o.chapter_id === chosen);
  const earlier = move?.options.filter((o) => o.relation === "earlier") ?? [];

  async function save() {
    if (!option) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/codex/move-fact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId, fact_op_id: factOpId, from_chapter_id: chapterId, to_chapter_id: option.chapter_id }),
      });
      const json = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        setError(json?.error ?? "The fact could not be moved. Try again.");
        return;
      }
      onMoved();
      onClose();
    } catch {
      setError("The fact could not be moved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="entry-start-dialog"
      aria-labelledby="fact-move-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="fact-move-title">Move to an earlier chapter</h2>
      {move && (
        <>
          <p style={{ margin: 0 }}>
            <strong>{move.label}</strong> <span className="meta">· set in {chLabel(move)}</span>
          </p>
          {earlier.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>
              There is no earlier chapter for it: the entry first appears in this one. Move where the entry first appears to go earlier.
            </p>
          ) : (
            <fieldset className="entry-start-list">
              <legend className="meta">Chapters on this branch</legend>
              {move.options.map((o) => {
                const now = o.relation === "now";
                return (
                  <label key={o.chapter_id} className={`entry-start-option${!o.allowed && !now ? " entry-start-blocked" : ""}`}>
                    <input type="radio" name="fact-move" value={o.chapter_id} checked={now ? chosen === null : chosen === o.chapter_id} disabled={!o.allowed} onChange={() => setChosen(o.chapter_id)} />
                    <span>
                      {chLabel(o)}
                      {now && <span className="tag"> · now</span>}
                      {!o.allowed && !now && o.reason && <span className="meta entry-start-reason">{o.reason}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {option ? (
            <div className="entry-start-summary">
              <p style={{ margin: 0 }}>
                It will hold from {chLabel(option)} on, as if it had been entered there. Its other changes stay where they are.
              </p>
              {option.gains > 0 && (
                <p className="meta" style={{ margin: 0 }}>
                  It will also be in {plural(option.gains, "chapter")} on other branches from there.
                </p>
              )}
            </div>
          ) : (
            earlier.length > 0 && (
              <p className="meta" style={{ margin: 0 }}>
                {earlier.some((o) => o.allowed) ? "Pick the chapter it should hold from." : "It can't move earlier: each chapter says why."}
              </p>
            )
          )}
        </>
      )}
      {!move && !error && <p className="meta" style={{ margin: 0 }}>Loading the chapters…</p>}
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div className="row entry-start-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={busy || !option} onClick={() => void save()}>
          {busy ? "Moving…" : option ? `Move to Ch. ${option.number}` : "Move"}
        </button>
      </div>
    </dialog>
  );
}
