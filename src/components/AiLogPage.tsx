"use client";

// The prompt history (/ai-log): the app's recent text AI calls, newest first, each openable to read (and copy) the
// prompt that was sent and the reply. The server keeps the last 200 calls from the last 3 days.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { copyText } from "@/lib/copyText";
import type { AiCallFull, AiCallSummary } from "@/lib/aiLog";

type Initial = { source: string; story: string; chapter: string; run: string; item: string };

const when = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export default function AiLogPage({ initial }: { initial: Initial }) {
  const [source, setSource] = useState(initial.source);
  const [story, setStory] = useState(initial.story);
  const [failedOnly, setFailedOnly] = useState(false);
  const [calls, setCalls] = useState<AiCallSummary[] | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Filters that only a link sets (and the server applies): shown in a notice with a way to clear them.
  const linked = [
    initial.run && `run ${initial.run.slice(0, 8)}`,
    initial.chapter && "one chapter",
    initial.item && "one Generate",
  ].filter(Boolean) as string[];

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams();
    if (source) q.set("source", source);
    if (initial.chapter) q.set("chapter", initial.chapter);
    if (initial.run) q.set("run", initial.run);
    if (initial.item) q.set("item", initial.item);
    if (failedOnly) q.set("failed", "1");
    fetch(`/api/ai-log?${q}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`The history couldn't be loaded (${res.status})`);
        return (await res.json()) as { calls: AiCallSummary[]; sources: string[] };
      })
      .then(
        (data) => {
          if (!live) return;
          setCalls(data.calls);
          setSources(data.sources);
          setProblem(null);
        },
        (e) => live && setProblem(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [source, failedOnly, initial.chapter, initial.run, initial.item]);

  // The stories that have calls here; the one chosen stays in the list even when it has none.
  const stories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of calls ?? []) if (c.story_id) seen.set(c.story_id, c.story_title ?? "A deleted story");
    if (story && !seen.has(story)) seen.set(story, "That story");
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [calls, story]);
  const shown = (calls ?? []).filter((c) => !story || c.story_id === story);

  if (openId) return <CallView id={openId} onBack={() => setOpenId(null)} />;

  const filtered = !!(source || story || failedOnly || linked.length);
  return (
    <div className="ai-log">
      <h1>Prompt history</h1>
      <p className="meta">The text AI calls made recently: what was sent, and what came back. Open one to read or copy it.</p>

      {linked.length > 0 && (
        <p className="notice" role="status">
          Showing only {linked.join(", ")}. <Link href="/ai-log">Show all calls</Link>
        </p>
      )}

      <div className="ai-log-filters">
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {source && !sources.includes(source) && <option value={source}>{source}</option>}
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Story
          <select value={story} onChange={(e) => setStory(e.target.value)}>
            <option value="">All stories</option>
            {stories.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-log-check">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
          Failed only
        </label>
      </div>

      {problem && <p className="error">{problem}</p>}
      {calls === null && !problem && <p className="meta">Loading…</p>}
      {calls && shown.length === 0 && (
        <p className="meta" data-testid="ai-log-empty">
          {filtered
            ? "No calls match these filters."
            : "No calls yet. Every text AI call is recorded here automatically; the last 200 calls from the last 3 days are kept."}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="ai-log-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className="ai-log-row" onClick={() => setOpenId(c.id)} data-source={c.source} data-status={c.status}>
                <span className="ai-log-top">
                  <strong>{c.source}</strong>
                  <span className={c.status === "ok" ? "meta" : "ai-log-bad"}>{c.status === "ok" ? "ok" : c.status === "failed" ? "failed" : "stopped"}</span>
                </span>
                <span className="meta ai-log-line">
                  {when(c.at)} · {took(c.ms)}
                  {c.side === "browser" ? " · browser" : ""}
                </span>
                <span className="meta ai-log-line">
                  {c.story_title ?? (c.story_id ? "A deleted story" : "No story")} · {c.model ?? "no model"}
                </span>
                {c.status === "failed" && c.error && <span className="ai-log-bad ai-log-line">{c.error}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The call as one block of plain text, to paste into a chat. */
function plainText(c: AiCallFull): string {
  const meta = [
    `Source: ${c.source}`,
    `Time: ${new Date(c.at).toISOString()} (${took(c.ms)})`,
    `Made by: ${c.side}`,
    c.story_title && `Story: ${c.story_title}`,
    c.connection && `Connection: ${c.connection}`,
    c.model && `Model: ${c.model}`,
    c.role && `Role: ${c.role}`,
    c.temperature !== null && `Temperature: ${c.temperature}`,
    `Thinking: ${c.thinking_off ? "off" : "default"}`,
    `Status: ${c.status}${c.error ? ` (${c.error})` : ""}`,
  ].filter(Boolean);
  const parts = [meta.join("\n")];
  if (c.system) parts.push(`## System\n\n${c.system}`);
  parts.push(`## ${messagesTitle(c)}\n\n${messagesText(c)}`);
  parts.push(`## Reply\n\n${c.reply ?? ""}`);
  return parts.join("\n\n");
}
const messagesTitle = (c: AiCallFull) => (c.messages.length === 1 ? "Message" : "Messages");
// One message is shown as it is; several are told apart by their role.
const messagesText = (c: AiCallFull) => (c.messages.length === 1 ? c.messages[0].content : c.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"));

function CallView({ id, onBack }: { id: string; onBack: () => void }) {
  const [call, setCall] = useState<AiCallFull | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/ai-log/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `The call couldn't be loaded (${res.status})`);
        return body.call as AiCallFull;
      })
      .then(
        (c) => live && setCall(c),
        (e) => live && setProblem(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="ai-log">
      <button type="button" className="secondary" onClick={onBack}>
        ← Back to the list
      </button>
      {problem && <p className="error">{problem}</p>}
      {!call && !problem && <p className="meta">Loading…</p>}
      {call && <CallDetail call={call} />}
    </div>
  );
}

function CallDetail({ call: c }: { call: AiCallFull }) {
  const [copied, setCopied] = useState("");
  const copy = async (what: string, text: string) => {
    setCopied((await copyText(text)) ? what : "");
    setTimeout(() => setCopied((now) => (now === what ? "" : now)), 2000);
  };
  const facts: [string, string | null][] = [
    ["Time", `${new Date(c.at).toLocaleString()} (${took(c.ms)})`],
    ["Made by", c.side === "browser" ? "The browser" : "The server"],
    ["Connection", c.connection],
    ["Model", c.model],
    ["Role", c.role],
    ["Temperature", c.temperature === null ? null : String(c.temperature)],
    ["Thinking", c.thinking_off ? "Switched off" : "Default"],
  ];
  const box = (key: string, title: string, text: string) => (
    <section className="ai-log-box" key={key}>
      <div className="ai-log-box-head">
        <h3>{title}</h3>
        <button type="button" className="secondary" onClick={() => void copy(key, text)}>
          {copied === key ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="ai-log-text" tabIndex={0}>
        {text || "(empty)"}
      </pre>
    </section>
  );
  return (
    <>
      <h1>{c.source}</h1>
      <p className={c.status === "ok" ? "meta" : "ai-log-bad"}>
        {c.status === "ok" ? "Finished" : c.status === "failed" ? "Failed" : "Stopped"}
        {c.error ? `: ${c.error}` : ""}
      </p>
      <dl className="ai-log-facts">
        {facts.map(([k, v]) =>
          v ? (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ) : null,
        )}
        <div>
          <dt>See also</dt>
          <dd className="ai-log-links">
            {c.story_id && <Link href={`/s/${c.story_id}`}>{c.story_title ?? "The story"}</Link>}
            {c.chapter_id && <Link href={`/c/${c.chapter_id}`}>The chapter</Link>}
            {c.run_id && <Link href={`/ai-log?run=${encodeURIComponent(c.run_id)}`}>Calls of the same run</Link>}
            {c.item_key && <Link href="/queue">The queue</Link>}
            {!c.story_id && !c.chapter_id && !c.run_id && !c.item_key && <span className="meta">Nothing linked</span>}
          </dd>
        </div>
      </dl>
      <div className="row">
        <button type="button" onClick={() => void copy("all", plainText(c))}>
          {copied === "all" ? "Copied" : "Copy all"}
        </button>
        <span className="meta">One block of text with all of the above, to paste into a chat.</span>
      </div>
      {c.system ? box("system", "System", c.system) : null}
      {box("messages", messagesTitle(c), messagesText(c))}
      {box("reply", "Reply", c.reply ?? "")}
    </>
  );
}
