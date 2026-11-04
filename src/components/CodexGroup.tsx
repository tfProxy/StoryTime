import type { ReactNode } from "react";

/**
 * One fold of the Story Bible's codex ("Characters (2) · 2 suggestions"): open when it has something in it. Every group,
 * including "Not in the codex yet", looks the same.
 */
export default function CodexGroup({ title, count, suggestions = 0, children }: { title: string; count: number; suggestions?: number; children: ReactNode }) {
  return (
    <details className="codex-group" open={count > 0 || suggestions > 0}>
      <summary>
        {title} ({count}){suggestions > 0 && <span className="codex-group-note"> · {suggestions} suggestion{suggestions === 1 ? "" : "s"}</span>}
      </summary>
      <div className="codex-group-body">{children}</div>
    </details>
  );
}
