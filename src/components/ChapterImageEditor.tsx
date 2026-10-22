"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareImage } from "@/lib/prepareImage";
import type { ImageMade } from "@/lib/imageSlots";
import { savedPictureApi, savedPictureUrl, type SavedSlot, type PictureTarget } from "@/lib/pictureTarget";
import { PictureMenu, loadPromptItem, openItem, startItems } from "./PictureButtons";
import type { StartRequest } from "./pictures";

// The longest side an uploaded illustration keeps. Bigger pictures are scaled down in the browser first.
const MAX_SIDE = 1600;

const LABELS: Record<SavedSlot, { title: string }> = {
  header: { title: "Header picture" },
  footer: { title: "Footer picture" },
  cover: { title: "Cover" },
};

type Props = {
  /** The chapter (for its header or footer) or the story (for its cover). */
  target: PictureTarget;
  slot: SavedSlot;
  version: number | null;
  /** What the saved picture was made from, when it came from ComfyUI. */
  made?: ImageMade | null;
  /** Called with `made` when the author asks to bring its prompt back. */
  onLoadPrompt?: (made: ImageMade) => void;
  /** Called with the saved picture's version to make new pictures starting from it: redrawn, or edited by instruction. */
  onStart?: (version: number, mode: StartRequest) => void;
  /** Why it can't be edited by instruction now, or null. */
  editBlocked?: string | null;
};

/**
 * Upload, replace or remove one of a chapter's pictures (or the story's cover), from the ☰ menu on its
 * corner (the same menu, with the same items where they apply, as a picture in the Pictures panel).
 * Changes apply straight away.
 */
export default function ChapterImageEditor({ target, slot, version: initial, made = null, onLoadPrompt, onStart, editBlocked = null }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(initial);
  // A picture saved elsewhere on the page (from ComfyUI) arrives as a new version prop after a refresh.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setVersion(initial);
  }
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const { title } = LABELS[slot];

  async function run(action: () => Promise<{ version: number | null; text: string }>) {
    setBusy(true);
    setStatus(null);
    try {
      const done = await action();
      setVersion(done.version);
      setStatus({ ok: true, text: done.text });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function request(init: RequestInit) {
    const res = await fetch(savedPictureApi(target, slot), init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }

  const url = version !== null ? savedPictureUrl(target, slot, version) : null;
  const unavailable = busy ? "Saving the picture…" : undefined;
  return (
    <section className="ai-panel image-editor">
      <h2>{title}</h2>
      <div className="picture-frame">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" title="Open full size">
            {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size */}
            <img className="image-editor-preview" src={url} alt={`${title} preview`} />
          </a>
        ) : (
          <div className="image-editor-empty">No picture yet</div>
        )}
        <div className="picture-marks">
          <PictureMenu
            items={[
              { label: busy ? "Saving…" : "Upload picture", title: unavailable, disabled: busy, run: () => input.current?.click() },
              ...(version !== null && onStart ? startItems((mode) => onStart(version, mode), editBlocked) : []),
              version !== null && made && onLoadPrompt && loadPromptItem(() => onLoadPrompt(made)),
              url !== null && openItem(url),
              version !== null && {
                label: slot === "header" ? "Clear Header" : slot === "footer" ? "Clear Footer" : "Clear Cover",
                title: unavailable,
                disabled: busy,
                run: () => void run(async () => (await request({ method: "DELETE" }), { version: null, text: "Picture removed." })),
              },
            ]}
          />
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label={`${title} file`}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run(async () => {
            const data = await request({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: await prepareImage(file, MAX_SIDE) });
            // The cover's answer names its version cover_version.
            return { version: (data.version ?? data.cover_version) as number, text: "Picture saved." };
          });
        }}
      />
      {status && <p className={status.ok ? "ok" : "error"} style={{ margin: 0 }}>{status.text}</p>}
    </section>
  );
}
