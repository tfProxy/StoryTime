"use client";

import { useEffect, useState } from "react";
import { codexIconUrl, type IconChoice } from "@/lib/codexIconUrl";
import { fetchImage, imageUrl, type ComfyImage } from "@/lib/comfy/client";
import type { PictureJob } from "@/lib/pictureJobs";
import { useSettings } from "@/lib/settings";

/** An icon is kept square, at most this many pixels a side (it is shown round and small). */
const ICON_SIDE = 512;
/** How many of the story's latest picture jobs are offered. */
const RECENT_JOBS = 20;

/** The middle square of the picture, scaled to at most ICON_SIDE, as a JPEG. Browser code. */
async function squareIcon(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob).catch(() => {
    throw new Error("That file isn't an image this browser can read.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.max(1, Math.min(ICON_SIDE, side));
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the picture.");
  ctx.fillStyle = "#fff"; // a see-through picture gets a white page behind it
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  const made = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!made) throw new Error("Couldn't prepare the picture.");
  return made;
}

/**
 * A codex entry's icon: the one it has now (with Remove), and a new one picked from the story's saved pictures, the
 * pictures made for the story lately (from ComfyUI, when it can be reached), or a file. The icon is the same in every
 * chapter and is never sent as a reference.
 */
export default function CodexIconPicker({
  storyId,
  entryId,
  entryName,
  version,
  saved,
  onChanged,
}: {
  storyId: string;
  entryId: string;
  entryName: string;
  /** The current icon's version, or null when the entry has none. */
  version: number | null;
  saved: IconChoice[];
  onChanged: () => void;
}) {
  const settings = useSettings();
  const comfyUrl = settings.comfy.url.trim();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [made, setMade] = useState<{ key: string; image: ComfyImage }[] | null>(null);

  // The story's latest pictures from ComfyUI (leaving out the trashed ones), once ComfyUI's address is known.
  useEffect(() => {
    if (!comfyUrl) return;
    let live = true;
    fetch(`/api/picture-jobs?story=${encodeURIComponent(storyId)}&limit=${RECENT_JOBS}`)
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d: { jobs?: PictureJob[] }) => {
        if (!live) return;
        const list = (d.jobs ?? []).flatMap((j) => j.images.flatMap((image, i) => (j.marks[i] === "rejected" ? [] : [{ key: `${j.id}:${i}`, image }])));
        setMade(list);
      })
      .catch(() => live && setMade([]));
    return () => {
      live = false;
    };
  }, [storyId, comfyUrl]);

  const api = `/api/stories/${storyId}/codex-icons/${encodeURIComponent(entryId)}`;

  async function use(key: string, get: () => Promise<Blob>) {
    setBusy(key);
    setStatus(null);
    try {
      const body = await squareIcon(await get());
      const res = await fetch(api, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save the icon (${res.status})`);
      setStatus({ ok: true, text: "Icon saved." });
      onChanged();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the icon of “${entryName}”?`)) return;
    setBusy("remove");
    setStatus(null);
    try {
      const res = await fetch(api, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't remove the icon (${res.status})`);
      setStatus({ ok: true, text: "Icon removed." });
      onChanged();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const fromUrl = (url: string) => async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't read the picture (${res.status}).`);
    return res.blob();
  };

  const choice = (key: string, label: string, thumb: string, get: () => Promise<Blob>) => (
    <li key={key}>
      <button type="button" className="secondary reference-choice" disabled={busy !== null} title={`Use ${label} as the icon`} onClick={() => void use(key, get)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
        <img src={thumb} alt="" loading="lazy" />
        <span className="reference-choice-label">{busy === key ? "Saving…" : label}</span>
      </button>
    </li>
  );

  return (
    <div className="icon-picker">
      <div className="icon-picker-current">
        {version !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size
          <img className="codex-icon large" src={codexIconUrl(storyId, entryId, version)} alt={`Icon of ${entryName}`} />
        ) : (
          <span className="codex-icon large codex-icon-empty" aria-hidden="true">
            {entryName.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span className="meta">{version !== null ? "Shown round in the codex and on this page, in every chapter." : "No icon yet. Pick one of the story's pictures, or upload one."}</span>
          <label>
            Upload a picture
            <input
              type="file"
              accept="image/*"
              aria-label="Icon file"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void use("upload", async () => file);
              }}
            />
          </label>
          {version !== null && (
            <div>
              <button type="button" className="secondary" disabled={busy !== null} onClick={() => void remove()}>
                {busy === "remove" ? "Removing…" : "Remove the icon"}
              </button>
            </div>
          )}
        </div>
      </div>
      <h3 style={{ margin: 0 }}>The story&apos;s saved pictures</h3>
      {saved.length === 0 ? (
        <p className="meta">No header, middle, footer or cover saved yet.</p>
      ) : (
        <ul className="reference-choices" aria-label="The story's saved pictures">
          {saved.map((c) => choice(c.key, c.label, c.url, fromUrl(c.url)))}
        </ul>
      )}
      {comfyUrl && (
        <>
          <h3 style={{ margin: 0 }}>Made lately</h3>
          {made === null ? (
            <p className="meta">Loading…</p>
          ) : made.length === 0 ? (
            <p className="meta">No pictures made for this story yet.</p>
          ) : (
            <ul className="reference-choices" aria-label="Pictures made lately">
              {made.map((m) => choice(m.key, "Picture", imageUrl(comfyUrl, m.image), () => fetchImage(comfyUrl, m.image)))}
            </ul>
          )}
        </>
      )}
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
    </div>
  );
}
