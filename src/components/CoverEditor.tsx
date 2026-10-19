"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StoryCover from "./StoryCover";

// The longest side an uploaded cover keeps. Bigger pictures are scaled down in the browser first.
const MAX_SIDE = 1200;

/** Scales the picture down (if it is big) and re-encodes it as a JPEG. */
async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't an image this browser can read.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the image.");
  ctx.fillStyle = "#fff"; // a see-through picture gets a white page behind it
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Couldn't prepare the image.");
  return blob;
}

/** Upload, replace or remove the story's cover image. Changes apply straight away. */
export default function CoverEditor({ story }: { story: { id: string; title: string; cover_version: number | null } }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(story.cover_version);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

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
    const res = await fetch(`/api/stories/${story.id}/cover`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }

  return (
    <section className="ai-panel cover-editor">
      <h2>Cover image</h2>
      <div className="cover-editor-body">
        <div className="cover-editor-preview">
          <StoryCover story={{ ...story, cover_version: version }} />
        </div>
        <div style={{ display: "grid", gap: "0.6rem", alignContent: "start" }}>
          <p className="meta" style={{ margin: 0 }}>
            Shown on the story list like the cover of a book (taller than wide works best).
            {version === null && " Until you add one, the story gets a generated cover."}
          </p>
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label="Cover image file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                const data = await request({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: await prepare(file) });
                return { version: data.cover_version as number, text: "Cover saved." };
              });
            }}
          />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Saving…" : version === null ? "Upload cover" : "Replace cover"}
            </button>
            {version !== null && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void run(async () => (await request({ method: "DELETE" }), { version: null, text: "Cover removed." }))}
              >
                Remove cover
              </button>
            )}
            {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
