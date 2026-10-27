"use client";

import { useState, useSyncExternalStore } from "react";
import type { ComfySettings as Comfy } from "@/lib/settingsSchema";
import { comfyVersion, listCheckpoints } from "@/lib/comfy/client";
import { checkFromServer } from "@/lib/serverCheck";

const noop = () => () => {};
/** This page's origin, which ComfyUI has to allow; "" while rendering on the server. */
const useOrigin = () => useSyncExternalStore(noop, () => location.origin, () => "");

/** Settings › Connections: where the ComfyUI machine is, and a connection test. */
export default function ComfyConnection({ comfy, onChange }: { comfy: Comfy; onChange: (patch: Partial<Comfy>) => void }) {
  const origin = useOrigin();
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingServer, setTestingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const version = await comfyVersion(comfy.url);
      const checkpoints = await listCheckpoints(comfy.url);
      setStatus({ ok: true, text: `Connected to ComfyUI ${version}. ${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} available.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function testFromServer() {
    setTestingServer(true);
    setServerStatus(null);
    setServerStatus(await checkFromServer({ kind: "comfy", url: comfy.url }));
    setTestingServer(false);
  }

  return (
    <section id="comfyui" className="settings-section">
      <h2>ComfyUI (pictures)</h2>
      <p className="meta" style={{ margin: 0 }}>
        Make chapter pictures on a ComfyUI machine from the Illustrate chapter page. The StoryTime server makes the pictures
        (so they go on with the page closed), and your browser talks to ComfyUI directly too (the setup check, and showing
        its pictures), so start ComfyUI with <code>--enable-cors-header {origin || "<this site's address>"}</code>
        {origin.startsWith("https:") && ", and serve it over https, since this page is on https"}. Its presets
        (checkpoints, LoRAs, workflows) are on the Drawing, Qwen edit and Flux edit tabs.
      </p>
      <label>
        ComfyUI address
        <input
          type="url"
          value={comfy.url}
          placeholder="https://comfy.example.ts.net"
          onChange={(e) => onChange({ url: e.target.value.trim() })}
        />
        <small>
          The StoryTime server uses this address too (it makes the pictures), so it must work from the machine StoryTime runs on
          (not <code>localhost</code> unless the service runs in the same container).
        </small>
      </label>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void test()} disabled={testing || !comfy.url}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className="secondary" onClick={() => void testFromServer()} disabled={testingServer || !comfy.url}>
          {testingServer ? "Testing…" : "Test from server"}
        </button>
        {status && <span className={status.ok ? "ok" : "error"}>{status.text}</span>}
        {serverStatus && <span className={serverStatus.ok ? "ok" : "error"}>{serverStatus.text}</span>}
      </div>
    </section>
  );
}
