"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryStart, StartItem, StartOption } from "@/lib/codexStart";

type Props = {
  start: EntryStart;
  storyId: string;
  /** The chapter the entry page shows the entry at, and its depth. */
  viewedChapterId: string;
  viewedDepth: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const chLabel = (o: { number: number; title: string }) => `Ch. ${o.number} “${o.title}”`;

/**
 * "First appears in <chapter> · Change…" under an entry's name on its page. Change… opens a dialog to pick another
 * chapter of this line for the entry to start at; the first version (and the facts entered with it) moves there.
 */
export default function EntryStartPicker({ start, storyId, viewedChapterId, viewedDepth }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  /** Moving later past facts set in between: the dialog asks whether to move them too. */
  const [asking, setAsking] = useState<StartItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  const option: StartOption | undefined = start.options.find((o) => o.chapter_id === chosen);
  const name = start.name;
  /** Later facts that stay where they are (moving later, those in between are counted apart). */
  const stays = Math.max(0, start.later_facts - (option?.relation === "later" ? option.between_facts : 0));

  function close() {
    setOpen(false);
    setChosen(null);
    setAsking(null);
    setError(null);
  }

  async function move(moveBetween: boolean) {
    if (!option) return;
    if (option.relation === "later" && option.between.length > 0 && !moveBetween) {
      setAsking(option.between);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/codex/move-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: start.entry_id, from_chapter_id: viewedChapterId, to_chapter_id: option.chapter_id, move_between: moveBetween }),
      });
      const json = (await r.json().catch(() => null)) as { error?: string; between?: StartItem[] } | null;
      if (r.status === 409 && json?.between) {
        setAsking(json.between);
        return;
      }
      if (!r.ok) {
        setError(json?.error ?? "The start could not be moved. Try again.");
        return;
      }
      close();
      // Moved past the chapter on show: the entry isn't there any more, so show it where it now starts.
      if (option.number - 1 > viewedDepth) router.push(`/s/${storyId}/codex/${start.entry_id}?at=${option.chapter_id}`);
      else router.refresh();
    } catch {
      setError("The start could not be moved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="meta entry-start">
        {/* The dot stays with the chapter; on a narrow screen Change… goes to the next line on its own. */}
        First appears in <strong>{chLabel(start)}</strong>
        {" · "}
        <button type="button" className="link-button entry-start-change" onClick={() => setOpen(true)}>
          Change…
        </button>
      </p>
      {open && (
        <dialog
          ref={dialog}
          className="entry-start-dialog"
          aria-labelledby="entry-start-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) close();
          }}
        >
          <h2 id="entry-start-title">Where {name} first appears</h2>
          {asking ? (
            <>
              <p style={{ margin: 0 }}>
                {name} has {plural(asking.length, "fact or change", "facts or changes")} between {chLabel(start)} and {option ? chLabel(option) : "there"}:
              </p>
              <ul className="entry-start-between">
                {asking.map((b, i) => (
                  <li key={i}>
                    {b.label} <span className="meta">· in “{b.chapter_title}”</span>
                  </li>
                ))}
              </ul>
              <p className="meta" style={{ margin: 0 }}>
                Move {asking.length === 1 ? "it" : "them"} to {option ? chLabel(option) : "the new start"} too? Otherwise nothing is moved.
              </p>
              {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
              <div className="row entry-start-actions">
                <button type="button" className="secondary" disabled={busy} onClick={close}>
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={() => void move(true)}>
                  {busy ? "Moving…" : `Move ${asking.length === 1 ? "it" : "them"} too`}
                </button>
              </div>
            </>
          ) : (
            <>
              <fieldset className="entry-start-list">
                <legend className="meta">Chapters on this branch</legend>
                {start.options.map((o) => {
                  const now = o.relation === "now";
                  return (
                    <label key={o.chapter_id} className={`entry-start-option${!o.allowed && !now ? " entry-start-blocked" : ""}`}>
                      <input type="radio" name="entry-start" value={o.chapter_id} checked={now ? chosen === null : chosen === o.chapter_id} disabled={!o.allowed} onChange={() => setChosen(o.chapter_id)} />
                      <span>
                        {chLabel(o)}
                        {now && <span className="tag"> · now</span>}
                        {!o.allowed && !now && o.reason && <span className="meta entry-start-reason">{o.reason}</span>}
                        {o.allowed && o.relation === "later" && o.between.length > 0 && <span className="meta entry-start-reason">{plural(o.between.length, "fact or change", "facts or changes")} in between</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {option ? (
                <div className="entry-start-summary">
                  <p style={{ margin: 0 }}>
                    <strong>Moves to {chLabel(option)}:</strong> the first version of {name}
                    {start.first_facts > 0 ? ` and the ${plural(start.first_facts, "fact")} entered with it` : ""}.
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Stays:</strong>{" "}
                    {stays > 0 ? `the ${plural(stays, "later fact")}, where ${stays === 1 ? "it was" : "they were"} set` : "everything set in later chapters"}.
                    {option.relation === "later" && option.between.length > 0 && ` The ${plural(option.between.length, "fact or change", "facts or changes")} in between would have to move too (you’ll be asked).`}
                  </p>
                  {option.relation === "later" ? (
                    <p className="meta" style={{ margin: 0 }}>
                      {name} won&apos;t be in the codex before {chLabel(option)}
                      {option.leaves > 0 ? `, nor in ${plural(option.leaves, "chapter")} on other branches` : ""}, so the AI won&apos;t know about it there.
                    </p>
                  ) : (
                    option.gains > 0 && (
                      <p className="meta" style={{ margin: 0 }}>
                        It will also be in {plural(option.gains, "chapter")} on other branches from there.
                      </p>
                    )
                  )}
                </div>
              ) : (
                <p className="meta" style={{ margin: 0 }}>
                  Pick the chapter {name} should first appear in. To start it later on another branch, view the entry at a chapter on that branch.
                </p>
              )}
              {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
              <div className="row entry-start-actions">
                <button type="button" className="secondary" disabled={busy} onClick={close}>
                  Cancel
                </button>
                <button type="button" disabled={busy || !option} onClick={() => void move(false)}>
                  {busy ? "Moving…" : option ? `Move to Ch. ${option.number}` : "Move"}
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
    </>
  );
}
