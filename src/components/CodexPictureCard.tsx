"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CodexPicture } from "@/lib/codexPictures";
import type { EntryType } from "@/lib/codex";
import { codexPictureUrl } from "@/lib/pictureTarget";
import { codexRole } from "@/lib/comfy/referenceChoices";
import { fromCodex } from "@/lib/comfy/startPicture";
import type { WorkspaceDestination } from "./PictureWorkspace";
import { PictureMenu, loadPromptItem, openItem, startItems } from "./PictureButtons";

type Props = {
  storyId: string;
  entry: { name: string; type: EntryType };
  /** The entry's picture as of the chapter the page was opened from (or from the start), or null. */
  current: CodexPicture | null;
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  /** What the workspace lets this card do (start from the picture, load its prompt). */
  workspace: WorkspaceDestination;
  /** For an entry linked to a shared entry: whether new pictures are kept for every story that uses it. Null for any other entry. */
  scope: { everyStory: boolean; onChange: (everyStory: boolean) => void } | null;
};

/**
 * The destination card of the codex page: the entry's picture as of the chapter the page was opened from, to
 * compare new pictures with, and the same ☰ menu as a picture in the Pictures panel. New pictures are saved
 * from their own ☰ menu (Use as codex picture: from the start, or from the chapter on).
 */
export default function CodexPictureCard({ storyId, entry, current, titles, workspace, scope }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const url = current ? codexPictureUrl(storyId, current.id) : null;
  const from = current ? (current.shared ? "Shared with every story that uses this entry" : current.anchor_chapter_id === null ? "From the start" : `From “${titles[current.anchor_chapter_id] ?? "a chapter"}” on`) : null;

  async function remove() {
    if (!current) return;
    if (current.shared && !window.confirm("This picture is shared, so removing it removes it from every story that uses this entry. Remove it?")) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(codexPictureUrl(storyId, current.id), { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setStatus({ ok: true, text: "Picture removed." });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const made = current?.made ?? null;
  return (
    <section className="ai-panel image-editor">
      <h2>Codex picture</h2>
      <div className="picture-frame">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" title="Open full size">
            {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
            <img className="image-editor-preview" src={url} alt="Codex picture preview" />
          </a>
        ) : (
          <div className="image-editor-empty">No picture yet</div>
        )}
        {current && (
          <div className="picture-marks">
            <PictureMenu
              items={[
                ...(workspace.comfyUrl
                  ? startItems((mode) => workspace.startFrom(fromCodex(storyId, current.id), mode, { label: entry.name, role: codexRole(entry.type) }), workspace.blocked)
                  : []),
                made && loadPromptItem(() => workspace.load({
                  prompt: made.prompt,
                  negative: made.negative,
                  seed: made.job?.seed ?? null,
                  settings: made.job && { checkpoint: made.job.checkpoint, width: made.job.width, height: made.job.height, denoise: null },
                })),
                url !== null && openItem(url),
                { label: busy ? "Removing…" : "Remove this picture", title: "The entry shows the picture before it again", disabled: busy, run: () => void remove() },
              ]}
            />
          </div>
        )}
      </div>
      {from && (
        <p className="meta" style={{ margin: 0 }}>
          {from}
          {current?.shared && <span className="tag"> · shared</span>}
        </p>
      )}
      {scope && (
        <label className="meta" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          Use for
          <select value={scope.everyStory ? "all" : "story"} onChange={(e) => scope.onChange(e.target.value === "all")} aria-label="Use for">
            <option value="story">this story only</option>
            <option value="all">every story that uses this entry</option>
          </select>
        </label>
      )}
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
    </section>
  );
}
