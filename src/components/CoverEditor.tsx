"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StoryCover from "./StoryCover";
import { prepareImage } from "@/lib/prepareImage";

// The longest side an uploaded cover keeps. Bigger pictures are scaled down in the browser first.
const MAX_SIDE = 1200;

/** Upload, replace or remove the story's cover image, or go to the cover page to make one. Changes apply straight away. */
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
                const data = await request({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: await prepareImage(file, MAX_SIDE) });
                return { version: data.cover_version as number, text: "Cover saved." };
              });
            }}
          />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Link className="button" href={`/s/${story.id}/cover`} title="Write a prompt for the cover and make pictures for it on your ComfyUI machine">
              Make a cover
            </Link>
            <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy}>
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
