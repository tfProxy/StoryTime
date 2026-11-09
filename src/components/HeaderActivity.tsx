"use client";

// The line under the header that says what the AI (or ComfyUI) is doing now, from any page: an AI call this page is
// making, a Generate, an AI run, or pictures being made, with how long the current step has taken and a thin moving
// bar. Opening the queue button's list shows everything. It also keeps `--header-h` on the page set to the header's
// height, so the sticky panels below it (the writing page's side panel, the Illustrate controls) stop under it.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWorkQueue, type GenerateItem, type RunItem } from "./WorkQueue";
import { useAiCalls } from "./GenerateProgress";
import { MODE_WORDS, runHref } from "./WorkQueueStatus";

/** "0:42", "12:05". */
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Line = { text: string; detail?: string; since?: number; href?: string };

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now - since >= 3000 ? <span className="header-activity-time"> {clock(now - since)}</span> : null;
}

export default function HeaderActivity() {
  const { items } = useWorkQueue();
  const calls = useAiCalls();
  const box = useRef<HTMLDivElement>(null);

  // The header's height, for the sticky panels below it (and the place a link to a field scrolls to).
  useEffect(() => {
    const header = box.current?.closest("header");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${header.getBoundingClientRect().height}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(header);
    return () => watch.disconnect();
  }, []);

  const lines: Line[] = [];
  // This page's own AI calls first: the author just pressed their button.
  for (const c of [...calls].reverse()) lines.push({ text: c.label, detail: c.step, since: c.since });
  for (const g of items.filter((i): i is GenerateItem => i.type === "generate" && i.state === "working")) {
    lines.push({ text: `Writing “${g.label}”`, detail: g.note, since: g.noteAt, href: g.href });
  }
  for (const r of items.filter((i): i is RunItem => i.type === "run" && i.state === "working")) {
    lines.push({ text: MODE_WORDS[r.mode], detail: `${r.done} of ${r.total}${r.current ? ` · now “${r.current}”` : ""}`, href: runHref(r) });
  }
  const making = items.filter((i) => i.type === "picture" && i.state === "making").length;
  if (making > 0) lines.push({ text: making === 1 ? "Making a picture" : `Making ${making} pictures`, href: "/queue" });

  const first = lines[0];
  return (
    <div ref={box} className="header-activity" hidden={!first}>
      {first && (
        <>
          <p className="header-activity-line" role="status">
            {/* On a narrow screen the name is cut short, so what it is doing stays in view. */}
            {first.href ? <Link href={first.href} className="header-activity-what">{first.text}</Link> : <span className="header-activity-what">{first.text}</span>}
            {first.detail && <span className="header-activity-detail"> · {first.detail}</span>}
            {first.since !== undefined && <Elapsed key={`${first.text}:${first.detail}:${first.since}`} since={first.since} />}
            {lines.length > 1 && <span className="header-activity-more"> · +{lines.length - 1} more</span>}
          </p>
          <div className="header-activity-bar" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
