"use client";

import { useState } from "react";

/** The first sentence (or first line, if it has no full stop) of a summary. */
export function firstSentence(text: string): string {
  const line = text.split("\n", 1)[0];
  return /^.*?[.!?…]["'”’)\]]*(?=\s|$)/.exec(line)?.[0] ?? line;
}

// A story's summary on the story list: the first sentence, with a [more] button for the rest.
export default function StorySummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const first = firstSentence(text);
  const hasMore = text.length > first.length;
  return (
    <p className="meta story-premise">
      {open || !hasMore ? text : first}
      {hasMore && (
        <>
          {" "}
          <button type="button" className="linkish summary-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "[less]" : "[more]"}
          </button>
        </>
      )}
    </p>
  );
}
