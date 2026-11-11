import type { KeptRequest } from "@/lib/keptRequests";

// The chapter reading page's "Written with …" fold: the kept AI requests that wrote the chapter's text (a Generate,
// then any revises), each with its connection, model, settings, time taken and the exact prompt. Server rendered.

/** "42 s", "3 min 05 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// Server rendered, so the server's clock zone would show; the owner reads Toronto time.
const when = (at: number) => new Date(at).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });

function Settings({ r }: { r: KeptRequest }) {
  const rows: [string, string][] = [
    ["Made by", `${r.source ?? "AI"}, ${when(r.at)}, from the ${r.side === "server" ? "StoryTime server" : "browser"}`],
    ["Connection", [r.connection ?? "?", r.kind && `(${r.kind})`, r.baseUrl].filter(Boolean).join(" ")],
    ["Model", r.model ?? "?"],
    ["Temperature", r.temperature === null ? "the model's default" : String(r.temperature)],
    ["Thinking", r.thinkingOff ? "turned off" : "as the model does by default"],
    ["Max tokens", r.maxTokens === null ? "not set" : String(r.maxTokens)],
    ["Time taken", `${duration(r.ms)}${r.firstTextMs !== null ? ` (first text after ${duration(r.firstTextMs)})` : ""}`],
  ];
  if (r.status !== "ok") rows.push(["Ended", r.status === "stopped" ? "stopped before the end" : `failed: ${r.error ?? ""}`]);
  return (
    <dl className="making-settings">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ChapterMaking({ requests }: { requests: KeptRequest[] }) {
  if (!requests.length) return null;
  const first = requests[0];
  const models = [...new Set(requests.map((r) => r.model ?? "?"))].join(", ");
  const total = requests.reduce((sum, r) => sum + r.ms, 0);
  return (
    <details className="chapter-making">
      <summary>
        Written with {models} on {first.connection ?? "?"}
        <span className="meta">
          {" "}
          · {duration(total)}
          {requests.length > 1 ? ` · ${requests.length} requests` : ""}
        </span>
      </summary>
      {requests.map((r, i) => (
        <section key={r.id} className="making-request" aria-label={`Request ${i + 1}`}>
          {requests.length > 1 && <h3>{i === 0 ? "Written" : `Revised (${i})`}</h3>}
          <Settings r={r} />
          <details className="making-text">
            <summary>Prompt</summary>
            {r.system && (
              <>
                <h4>System</h4>
                <pre>{r.system}</pre>
              </>
            )}
            {r.messages.map((m, j) => (
              <div key={j}>
                <h4>{m.role === "user" ? "User" : "Assistant"}</h4>
                <pre>{m.content}</pre>
              </div>
            ))}
          </details>
          <details className="making-text">
            <summary>Reply as sent</summary>
            <pre>{r.reply}</pre>
          </details>
        </section>
      ))}
    </details>
  );
}
