"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Row = {
  kind: "story" | "chapter" | "choice" | "codex_op";
  id: string;
  story_id: string;
  story_title: string;
  label: string;
  preview: string | null;
  author: string;
  at: number;
  removed_at: number | null;
};

type Props = {
  rows: Row[];
  stats: { stories: number; chapters: number; codexOps: number; removed: number };
  filters: { kind: string; removed: boolean; story: string; limit: number };
};

type Revision = { revision: number; title: string; body: string; edited_by: string; edit_note: string | null; created_at: number };

const KIND_LABEL: Record<Row["kind"], string> = { story: "Story", chapter: "Chapter", choice: "Choice", codex_op: "Codex" };
const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export default function AdminPanel({ rows, stats, filters }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [openRevisions, setOpenRevisions] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);

  async function act(row: Row, action: "remove" | "restore" | "delete") {
    const what = `${KIND_LABEL[row.kind].toLowerCase()} “${row.label}”`;
    const prompt =
      action === "remove"
        ? row.kind === "chapter"
          ? `Remove ${what} and every chapter below it? It can be restored later.`
          : `Remove ${what}? It can be restored later.`
        : action === "delete"
          ? `PERMANENTLY delete ${what} and everything below it? This cannot be undone.`
          : "";
    if (prompt && !window.confirm(prompt)) return;
    setBusy(row.id);
    setMessage(null);
    try {
      const r = await postJson("/api/admin/action", { action, kind: row.kind, id: row.id });
      const text =
        action === "remove"
          ? `Removed${r.hidden ? `, hiding ${r.hidden} chapter${r.hidden === 1 ? "" : "s"} below it` : ""}.`
          : action === "restore"
            ? `Restored.${r.note ? ` ${r.note}` : ""}`
            : `Deleted ${r.chapters} chapter${r.chapters === 1 ? "" : "s"} and ${r.codexOps} codex change${r.codexOps === 1 ? "" : "s"}.`;
      setMessage({ ok: true, text });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleRevisions(row: Row) {
    if (openRevisions === row.id) {
      setOpenRevisions(null);
      return;
    }
    setOpenRevisions(row.id);
    setRevisions(null);
    try {
      const res = await fetch(`/api/chapters/${row.id}/revisions`);
      setRevisions(res.ok ? await res.json() : []);
    } catch {
      setRevisions([]);
    }
  }

  async function revert(row: Row, revision: number) {
    if (!window.confirm(`Put revision ${revision} back as the current text? The current text stays in the history.`)) return;
    setBusy(row.id);
    setMessage(null);
    try {
      await postJson("/api/admin/revert", { chapter_id: row.id, revision });
      setMessage({ ok: true, text: `Reverted to revision ${revision}.` });
      setOpenRevisions(null);
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await postJson("/api/admin/logout", {}).catch(() => {});
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className="meta" style={{ margin: 0 }}>
          {stats.stories} stories · {stats.chapters} chapters · {stats.codexOps} codex changes · {stats.removed} removed items
        </span>
        <button type="button" className="secondary" onClick={logout}>
          Sign out
        </button>
      </div>

      <form method="get" className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ width: "auto" }}>
          Show
          <select name="kind" defaultValue={filters.kind}>
            <option value="">Everything</option>
            <option value="chapter">Chapters</option>
            <option value="story">Stories</option>
            <option value="choice">Choices</option>
            <option value="codex_op">Codex changes</option>
          </select>
        </label>
        <label style={{ width: "auto" }}>
          Story id
          <input name="story" defaultValue={filters.story} placeholder="any" style={{ width: "10rem" }} />
        </label>
        <label style={{ width: "auto", display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input type="checkbox" name="removed" value="1" defaultChecked={filters.removed} style={{ width: "auto" }} />
          Removed only
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      {message && <p className={message.ok ? "ok" : "error"}>{message.text}</p>}
      {rows.length === 0 && <p className="meta">Nothing matches.</p>}

      {rows.map((r) => {
        const removed = r.removed_at !== null;
        return (
          <article key={`${r.kind}-${r.id}`} className="card" style={{ opacity: removed ? 0.7 : 1 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span className="tag">{KIND_LABEL[r.kind]}</span> <strong>{r.label}</strong>{" "}
                {removed && <span className="tag">· REMOVED {when(r.removed_at!)}</span>}
                <div className="meta" style={{ margin: 0 }}>
                  {r.story_title} · {r.author ? `by ${r.author} · ` : ""}
                  {when(r.at)} · <code>{r.id}</code>
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {r.kind === "chapter" && !removed && (
                  <>
                    <Link className="button secondary" href={`/c/${r.id}`}>
                      View
                    </Link>
                    <button type="button" className="secondary" onClick={() => toggleRevisions(r)}>
                      Revisions
                    </button>
                  </>
                )}
                {r.kind === "story" && !removed && (
                  <Link className="button secondary" href={`/s/${r.id}`}>
                    View
                  </Link>
                )}
                {removed ? (
                  <button type="button" className="secondary" disabled={busy === r.id} onClick={() => act(r, "restore")}>
                    Restore
                  </button>
                ) : (
                  <button type="button" className="secondary" disabled={busy === r.id} onClick={() => act(r, "remove")}>
                    Remove
                  </button>
                )}
                {removed && (r.kind === "chapter" || r.kind === "story") && (
                  <button type="button" className="danger" disabled={busy === r.id} onClick={() => act(r, "delete")}>
                    Delete permanently
                  </button>
                )}
              </div>
            </div>
            {r.preview && <p className="meta" style={{ margin: "0.5rem 0 0" }}>{r.preview}</p>}

            {openRevisions === r.id && (
              <div className="history">
                {revisions === null && <span className="meta">Loading…</span>}
                {revisions?.length === 0 && <span className="meta">This chapter has never been edited.</span>}
                {revisions?.map((v) => (
                  <div key={v.revision}>
                    <div className="meta" style={{ margin: 0 }}>
                      <strong>Revision {v.revision}</strong> · {when(v.created_at)}
                      {v.edited_by && ` · by ${v.edited_by}`}
                      {v.edit_note && ` · ${v.edit_note}`}
                    </div>
                    <div className="version">
                      <strong>{v.title}</strong>
                      <div style={{ whiteSpace: "pre-wrap" }}>{v.body.length > 400 ? `${v.body.slice(0, 400)}…` : v.body}</div>
                    </div>
                    <button type="button" className="secondary" disabled={busy === r.id} onClick={() => revert(r, v.revision)}>
                      Revert to this version
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
