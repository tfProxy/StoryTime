"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareImage } from "@/lib/prepareImage";
import { chapterImageUrl, type ImageSlot } from "@/lib/imageSlots";

// The longest side an uploaded illustration keeps. Bigger pictures are scaled down in the browser first.
const MAX_SIDE = 1600;

const LABELS: Record<ImageSlot, { title: string; where: string }> = {
  header: { title: "Header picture", where: "Shown above the chapter's title." },
  footer: { title: "Footer picture", where: "Shown after the chapter's text, before the choices." },
};

/** Upload, replace or remove one of a chapter's pictures. Changes apply straight away. */
export default function ChapterImageEditor({ chapterId, slot, version: initial }: { chapterId: string; slot: ImageSlot; version: number | null }) {
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
  const { title, where } = LABELS[slot];

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
    const res = await fetch(`/api/chapters/${chapterId}/images/${slot}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }

  return (
    <section className="ai-panel image-editor">
      <h2>{title}</h2>
      <p className="meta" style={{ margin: 0 }}>{where}</p>
      {version !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- an uploaded picture of unknown size
        <img className="image-editor-preview" src={chapterImageUrl(chapterId, slot, version)} alt={`${title} preview`} />
      ) : (
        <div className="image-editor-empty">No picture yet</div>
      )}
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
            return { version: data.version as number, text: "Picture saved." };
          });
        }}
      />
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Saving…" : version === null ? "Upload picture" : "Replace picture"}
        </button>
        {version !== null && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void run(async () => (await request({ method: "DELETE" }), { version: null, text: "Picture removed." }))}
          >
            Remove picture
          </button>
        )}
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
      </div>
    </section>
  );
}
