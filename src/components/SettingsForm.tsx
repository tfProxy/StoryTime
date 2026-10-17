"use client";

import { useRef, useState } from "react";
import { PROVIDERS, providerInfo, type ProviderId } from "@/lib/ai/providers";
import { AiError, listModels, streamChat } from "@/lib/ai/client";
import {
  exportSettingsJson,
  importSettingsJson,
  saveSettings,
  useSettings,
  type ProviderSettings,
  type Settings,
} from "@/lib/settings";

const CUSTOM = "__custom__";

// A real <select> once models are known (datalists don't open on iOS/Android), with a way to type any name.
function ModelField({
  value,
  models,
  blankLabel,
  onChange,
}: {
  value: string;
  models: string[];
  blankLabel?: string;
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  if (models.length === 0 || custom) {
    return (
      <span className="row">
        <input value={value} onChange={(e) => onChange(e.target.value)} />
        {models.length > 0 && (
          <button type="button" className="secondary" onClick={() => setCustom(false)}>
            List
          </button>
        )}
      </span>
    );
  }
  const known = value === "" || models.includes(value);
  return (
    <select
      value={known ? value : CUSTOM}
      onChange={(e) => {
        if (e.target.value === CUSTOM) setCustom(true);
        else onChange(e.target.value);
      }}
    >
      {blankLabel ? <option value="">{blankLabel}</option> : !known || value === "" ? <option value="">Choose a model…</option> : null}
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      {!known && <option value={CUSTOM}>{value} (typed)</option>}
      <option value={CUSTOM}>Type a name…</option>
    </select>
  );
}

export default function SettingsForm() {
  const settings = useSettings();
  const info = providerInfo(settings.activeProvider);
  const p = settings.providers[settings.activeProvider];

  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [trying, setTrying] = useState(false);
  const [reply, setReply] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function update(patch: Partial<Settings>) {
    void saveSettings({ ...settings, ...patch }).then((saved) => {
      if (!saved) setStatus({ kind: "error", text: "The server couldn't save the settings. Your changes will be lost on reload." });
    });
  }
  function updateProvider(patch: Partial<ProviderSettings>) {
    update({
      providers: { ...settings.providers, [settings.activeProvider]: { ...p, ...patch } },
    });
  }

  async function testConnection() {
    setTesting(true);
    setStatus(null);
    try {
      const ids = await listModels(settings);
      setModels(ids);
      setStatus({
        kind: "ok",
        text: `Connected. ${ids.length} model${ids.length === 1 ? "" : "s"} available${ids.length ? " (pick one in the Model field below)" : ""}.`,
      });
    } catch (e) {
      setModels([]);
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function tryIt() {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setTrying(true);
    setReply("");
    setStatus(null);
    try {
      let text = "";
      for await (const piece of streamChat(settings, {
        system: "You are a concise assistant.",
        messages: [{ role: "user", content: "Write one sentence that opens a fantasy adventure story." }],
        maxTokens: 120,
        signal: ctl.signal,
      })) {
        text += piece;
        setReply(text);
      }
      if (!text) setStatus({ kind: "error", text: "The model returned an empty reply." });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setStatus({ kind: "error", text: e instanceof AiError || e instanceof Error ? e.message : String(e) });
    } finally {
      setTrying(false);
    }
  }

  function exportFile() {
    const blob = new Blob([exportSettingsJson(settings)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "storytime-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const next = importSettingsJson(text);
      const saved = await saveSettings(next);
      setStatus(saved ? { kind: "ok", text: "Settings imported." } : { kind: "error", text: "The server couldn't save the imported settings." });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't read that file" });
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <p className="notice">
        These settings, including your API keys, are stored on the StoryTime server and shared by every browser that
        uses it. AI requests still go directly from your browser to the provider you choose, so the key is sent to
        your browser when a page loads. Only use StoryTime on a server and network you trust.
      </p>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          AI provider
          <select
            value={settings.activeProvider}
            onChange={(e) => {
              setModels([]);
              setStatus(null);
              update({ activeProvider: e.target.value as ProviderId });
            }}
          >
            {PROVIDERS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <small>{info.hint}</small>
        </label>

        <label>
          Server URL
          <input value={p.baseUrl} onChange={(e) => updateProvider({ baseUrl: e.target.value })} />
        </label>

        <label>
          API key {!info.needsKey && <small>(optional)</small>}
          <span className="row">
            <input
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={p.apiKey}
              onChange={(e) => updateProvider({ apiKey: e.target.value })}
            />
            <button type="button" className="secondary" onClick={() => setShowKey(!showKey)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </span>
        </label>

        <div className="row">
          <button type="button" onClick={testConnection} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
        {status && <p className={status.kind === "error" ? "error" : "ok"}>{status.text}</p>}

        <label>
          Model
          <ModelField value={p.model} models={models} onChange={(v) => updateProvider({ model: v })} />
        </label>

        <label>
          Cheaper model <small>(for summaries and small jobs; leave blank to use the main model)</small>
          <ModelField
            value={p.summaryModel}
            models={models}
            blankLabel="Same as the main model"
            onChange={(v) => updateProvider({ summaryModel: v })}
          />
        </label>

        <label>
          Temperature <small>(leave blank for the provider&apos;s default)</small>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature ?? ""}
            onChange={(e) => update({ temperature: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>

        <label>
          Context budget <small>(approximate tokens of story context to send; lower it for small local models)</small>
          <input
            type="number"
            min={1000}
            step={500}
            value={settings.contextTokens}
            onChange={(e) => update({ contextTokens: Math.max(1000, Number(e.target.value) || 1000) })}
          />
        </label>

        <label className="row" style={{ alignItems: "flex-start" }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={settings.disableThinking}
            onChange={(e) => update({ disableThinking: e.target.checked })}
          />
          <span>
            Disable thinking{" "}
            <small>
              (asks the model to skip extended thinking, for faster and cheaper replies. Sent as thinking: disabled to
              Anthropic and reasoning_effort: none to other providers; turn it off if your model rejects that.)
            </small>
          </span>
        </label>

        <div className="row">
          <button type="button" className="secondary" onClick={tryIt} disabled={trying}>
            {trying ? "Generating…" : "Try a sample reply"}
          </button>
          {trying && (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
        {reply && (
          <blockquote className="sample">
            {reply}
          </blockquote>
        )}
      </form>

      <section>
        <h2>Back up or move your settings</h2>
        <div className="row">
          <button type="button" className="secondary" onClick={exportFile}>
            Export to file
          </button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            Import from file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="meta">
          The exported file contains your API keys. Keep it private.
        </p>
      </section>
    </div>
  );
}
