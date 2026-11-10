"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RetconPreview } from "@/lib/retcons";

type CodexFact = { entryId: string; entryName: string; factId: string; aspect: string; form: string; text: string };

const list = (items: { title: string }[], max = 4) => {
  const names = items.map((c) => `“${c.title}”`);
  return names.length > max ? `${names.slice(0, max - 1).join(", ")} and ${names.length - max + 1} more` : names.join(", ");
};

/**
 * Starts a retcon at a chapter: a codex fact's new text (`fact` given), or a change described in words. Shows what the
 * AI will read before anything changes, then starts the run and goes to the list below.
 */
export default function RetconStart({ storyId, chapter, fact, cancelHref }: { storyId: string; chapter: { id: string; title: string }; fact?: CodexFact; cancelHref: string }) {
  const router = useRouter();
  const [text, setText] = useState(fact?.text ?? "");
  const [from, setFrom] = useState<"set" | "here">("set");
  const [all, setAll] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [only, setOnly] = useState("");
  const [preview, setPreview] = useState<RetconPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const body = fact
    ? { kind: "codex" as const, chapter_id: chapter.id, entry_id: fact.entryId, fact_id: fact.factId, text: text.trim() || fact.text, from, all }
    : { kind: "note" as const, chapter_id: chapter.id, instruction: instruction.trim() || "-", only };
  const key = JSON.stringify(fact ? { from, all } : { only });

  // The preview depends only on where it starts and the filter, not on the new text.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/stories/${storyId}/retcons/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!live) return;
          if (!res.ok) throw new Error(data.error ?? `Couldn't work out the chapters (${res.status})`);
          setPreview(data);
          setProblem(null);
        })
        .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, chapter.id, key]);

  const ready = fact ? text.trim() !== "" && text.trim() !== fact.text.trim() : instruction.trim() !== "";

  async function start() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/stories/${storyId}/retcons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't start the retcon (${res.status})`);
      router.push(`/s/${storyId}/review?tab=retcons&chapter=${chapter.id}#retcon-${data.id}`);
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const n = preview?.chapters.length ?? 0;
  return (
    <section className="card retcon-start" aria-label="Start a retcon">
      <h2>{fact ? `Retcon ${fact.entryName}: ${fact.aspect || "a fact"}` : `Retcon from “${chapter.title}”`}</h2>
      <p className="meta">
        A retcon changes a detail as if it had always been so. The AI reads the chapters below and proposes small changes to the passages that no longer fit. Nothing in a chapter changes until you accept it, and you can undo the whole retcon.
      </p>
      {fact ? (
        <>
          <p>
            <span className="meta">Now:</span> {fact.text}
          </p>
          <label className="retcon-field">
            <span className="meta">Change it to</span>
            <textarea value={text} rows={3} maxLength={1000} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit" }} />
          </label>
          {preview?.canSet && preview.setAt && preview.setAt.id !== chapter.id && (
            <fieldset className="retcon-from">
              <legend className="meta">From</legend>
              <label>
                <input type="radio" name="retcon-from" checked={from === "set"} onChange={() => setFrom("set")} /> Where it was set, “{preview.setAt.title}”
              </label>
              <label>
                <input type="radio" name="retcon-from" checked={from === "here"} onChange={() => setFrom("here")} /> This chapter on, “{chapter.title}” (earlier chapters keep the old version)
              </label>
            </fieldset>
          )}
          <label className="retcon-check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Also read chapters that don&apos;t name {fact.entryName} (slower)
          </label>
        </>
      ) : (
        <>
          <label className="retcon-field">
            <span className="meta">What is different now</span>
            <textarea
              value={instruction}
              rows={4}
              maxLength={2000}
              placeholder="The tavern was always called the Gilded Goose, not the Red Lion."
              onChange={(e) => setInstruction(e.target.value)}
              style={{ fontFamily: "inherit" }}
            />
          </label>
          <label className="retcon-field">
            <span className="meta">Only read chapters that mention (names or words, comma-separated; leave empty for every chapter)</span>
            <input value={only} maxLength={500} placeholder="Red Lion, tavern" onChange={(e) => setOnly(e.target.value)} />
          </label>
          <p className="meta">The codex isn&apos;t changed by a retcon in words. Change it yourself if it records the detail.</p>
        </>
      )}
      {preview && (
        <p className="meta retcon-scope" role="status">
          {n === 0
            ? fact
              ? `No chapter from “${preview.start.title}” on names ${fact.entryName}, so only the codex changes.`
              : "No chapter to read."
            : `The AI reads ${n === 1 ? "1 chapter" : `${n} chapters`} from “${preview.start.title}” on: ${list(preview.chapters)}.`}
          {preview.skipped > 0 && ` ${preview.skipped} more ${preview.skipped === 1 ? "is" : "are"} left out by the filter.`}
          {preview.stops.length > 0 && ` It stops at ${list(preview.stops, 3)}, where the fact changes again in the story.`}
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="button" disabled={!ready || busy || !preview} onClick={() => void start()}>
          {busy ? "Starting…" : n === 0 && fact ? "Change the codex" : "Start the retcon"}
        </button>
        <Link href={cancelHref} className="button secondary">
          Cancel
        </Link>
      </div>
    </section>
  );
}
