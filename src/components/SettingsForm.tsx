"use client";

import { useRef, useState } from "react";
import { PROVIDERS, providerInfo, type ProviderKind } from "@/lib/ai/providers";
import { AiError, listModels, streamChat } from "@/lib/ai/client";
import PromptButton from "./PromptButton";
import {
  exportSettingsJson,
  findConnection,
  importSettingsJson,
  modelLabel,
  newConnection,
  parseRefKey,
  refKey,
  removeConnection,
  sameRef,
  saveSettings,
  useSettings,
  type Connection,
  type ModelRef,
  type Settings,
} from "@/lib/settings";

// What "Try a sample reply" sends.
const SAMPLE_REQUEST = {
  system: "You are a concise assistant.",
  message: "Write one sentence that opens a fantasy adventure story.",
};

// Long lists (OpenRouter has hundreds of models) only show this many until filtered.
const SHOW_MODELS = 60;

type Status = { kind: "ok" | "error"; text: string };

function ConnectionCard({
  conn,
  settings,
  onChange,
  onRemove,
  onToggleFavorite,
}: {
  conn: Connection;
  settings: Settings;
  onChange: (patch: Partial<Connection>) => void;
  onRemove: () => void;
  onToggleFavorite: (ref: ModelRef) => void;
}) {
  const info = providerInfo(conn.kind);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [typed, setTyped] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const ids = await listModels(conn);
      setModels(ids);
      setStatus({
        kind: "ok",
        text: `Connected. ${ids.length} model${ids.length === 1 ? "" : "s"} available${ids.length ? "; star the ones you want to use" : ""}.`,
      });
    } catch (e) {
      setModels(null);
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  const isFav = (model: string) => settings.favorites.some((f) => sameRef(f, { connectionId: conn.id, model }));
  const q = filter.trim().toLowerCase();
  const matching = (models ?? []).filter((m) => !q || m.toLowerCase().includes(q));
  const shown = matching.slice(0, SHOW_MODELS);

  function addTyped() {
    const model = typed.trim();
    if (!model) return;
    if (!isFav(model)) onToggleFavorite({ connectionId: conn.id, model });
    setTyped("");
  }

  return (
    <fieldset className="card connection" aria-label={conn.name || info.label}>
      <legend>
        {conn.name || info.label} <span className="meta">({info.label})</span>
      </legend>
      <label>
        Name
        <input value={conn.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label>
        Server URL
        <input value={conn.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} />
        <small>{info.hint}</small>
      </label>
      <label>
        API key {!info.needsKey && <small>(optional)</small>}
        <span className="row">
          <input
            type={showKey ? "text" : "password"}
            autoComplete="off"
            value={conn.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
          <button type="button" className="secondary" onClick={() => setShowKey(!showKey)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={test} disabled={testing}>
          {testing ? "Testing…" : models ? "Refresh models" : "Test connection"}
        </button>
        <button type="button" className="secondary" onClick={onRemove}>
          Remove connection
        </button>
      </div>
      {status && <p className={status.kind}>{status.text}</p>}

      {models && models.length > 0 && (
        <div className="model-list">
          {models.length > 8 && (
            <input
              type="search"
              placeholder={`Filter ${models.length} models`}
              aria-label="Filter models"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <ul className="codex-picks">
            {shown.map((m) => (
              <li key={m} className="codex-pick">
                <span style={{ overflowWrap: "anywhere" }}>{m}</span>
                <button
                  type="button"
                  className={isFav(m) ? "" : "secondary"}
                  aria-pressed={isFav(m)}
                  aria-label={`${isFav(m) ? "Unstar" : "Star"} ${m}`}
                  onClick={() => onToggleFavorite({ connectionId: conn.id, model: m })}
                >
                  {isFav(m) ? "★ Starred" : "☆ Star"}
                </button>
              </li>
            ))}
          </ul>
          {matching.length > shown.length && (
            <p className="meta">
              Showing {shown.length} of {matching.length}. Type in the filter to find others.
            </p>
          )}
        </div>
      )}

      <label>
        Add a model by name <small>(for models the server doesn&apos;t list)</small>
        <span className="row">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addTyped();
              }
            }}
          />
          <button type="button" className="secondary" onClick={addTyped} disabled={!typed.trim()}>
            Star
          </button>
        </span>
      </label>
    </fieldset>
  );
}

/** A default-model dropdown over the starred models. */
function DefaultSelect({
  settings,
  value,
  blankLabel,
  onChange,
}: {
  settings: Settings;
  value: ModelRef | null;
  blankLabel: string;
  onChange: (ref: ModelRef | null) => void;
}) {
  const starred = !value || settings.favorites.some((f) => sameRef(f, value));
  return (
    <select value={value ? refKey(value) : ""} onChange={(e) => onChange(e.target.value ? parseRefKey(e.target.value) : null)}>
      <option value="">{blankLabel}</option>
      {value && !starred && <option value={refKey(value)}>{modelLabel(settings, value)}</option>}
      {settings.favorites.map((f) => (
        <option key={refKey(f)} value={refKey(f)}>
          {modelLabel(settings, f)}
        </option>
      ))}
    </select>
  );
}

export default function SettingsForm() {
  const settings = useSettings();
  const [addKind, setAddKind] = useState<ProviderKind>("ollama");
  const [status, setStatus] = useState<Status | null>(null);
  const [trying, setTrying] = useState(false);
  const [reply, setReply] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function save(next: Settings) {
    void saveSettings(next).then((saved) => {
      if (!saved) setStatus({ kind: "error", text: "The server couldn't save the settings. Your changes will be lost on reload." });
    });
  }
  const update = (patch: Partial<Settings>) => save({ ...settings, ...patch });

  function updateConnection(id: string, patch: Partial<Connection>) {
    update({ connections: settings.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  function addConnection() {
    update({ connections: [...settings.connections, newConnection(settings, addKind)] });
  }

  function deleteConnection(c: Connection) {
    const favs = settings.favorites.filter((f) => f.connectionId === c.id).length;
    const what = favs ? ` and its ${favs} starred model${favs === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Remove “${c.name || providerInfo(c.kind).label}”${what}?`)) return;
    save(removeConnection(settings, c.id));
  }

  function toggleFavorite(ref: ModelRef) {
    if (settings.favorites.some((f) => sameRef(f, ref))) {
      const clear = (r: ModelRef | null) => (sameRef(r, ref) ? null : r);
      update({
        favorites: settings.favorites.filter((f) => !sameRef(f, ref)),
        defaults: { main: clear(settings.defaults.main), cheap: clear(settings.defaults.cheap) },
      });
    } else {
      // The first model starred becomes the default, so a fresh setup works straight away.
      update({
        favorites: [...settings.favorites, { ...ref, label: "" }],
        defaults: settings.defaults.main ? settings.defaults : { ...settings.defaults, main: ref },
      });
    }
  }

  function renameFavorite(ref: ModelRef, label: string) {
    update({ favorites: settings.favorites.map((f) => (sameRef(f, ref) ? { ...f, label } : f)) });
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
        system: SAMPLE_REQUEST.system,
        messages: [{ role: "user", content: SAMPLE_REQUEST.message }],
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
        <section className="settings-section">
          <h2>Connections</h2>
          <p className="meta">
            Add each AI server you use. You can have several, even of the same kind (say, Ollama on two machines).
          </p>
          {settings.connections.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              settings={settings}
              onChange={(patch) => updateConnection(c.id, patch)}
              onRemove={() => deleteConnection(c)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
          <div className="row">
            <select aria-label="Kind of connection" value={addKind} onChange={(e) => setAddKind(e.target.value as ProviderKind)} style={{ width: "auto" }}>
              {PROVIDERS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={addConnection}>
              Add connection
            </button>
          </div>
        </section>

        <section id="models" className="settings-section">
          <h2>Starred models</h2>
          {settings.favorites.length === 0 ? (
            <p className="meta">
              None yet. Test a connection above and star the models you want; they become the choices on the writing page.
            </p>
          ) : (
            <>
              <p className="meta">These are the models you can switch between while writing. A nickname is optional.</p>
              <ul className="codex-picks">
                {settings.favorites.map((f) => {
                  const conn = findConnection(settings, f.connectionId);
                  return (
                    <li key={refKey(f)} className="codex-pick" style={{ flexWrap: "wrap" }}>
                      <span style={{ flex: "1 1 12rem", overflowWrap: "anywhere" }}>
                        {f.model}
                        <span className="meta"> · {conn?.name || (conn ? providerInfo(conn.kind).label : "")}</span>
                      </span>
                      <input
                        aria-label={`Nickname for ${f.model}`}
                        placeholder="Nickname"
                        value={f.label}
                        onChange={(e) => renameFavorite(f, e.target.value)}
                        style={{ flex: "1 1 8rem", width: "auto" }}
                      />
                      <button type="button" className="secondary" onClick={() => toggleFavorite(f)} aria-label={`Unstar ${f.model}`}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <label>
            Default model <small>(for writing chapters; each draft can pick another)</small>
            <DefaultSelect
              settings={settings}
              value={settings.defaults.main}
              blankLabel="Choose a starred model…"
              onChange={(r) => update({ defaults: { ...settings.defaults, main: r } })}
            />
          </label>
          <label>
            Cheaper model <small>(for summaries, suggestions and small jobs; drafts can pick another for suggestions)</small>
            <DefaultSelect
              settings={settings}
              value={settings.defaults.cheap}
              blankLabel="Same as the default model"
              onChange={(r) => update({ defaults: { ...settings.defaults, cheap: r } })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h2>Options</h2>
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
                Anthropic, reasoning: {"{"}effort: none{"}"} to OpenRouter and reasoning_effort: none to others; turn it
                off if your model rejects that.)
              </small>
            </span>
          </label>

          <label className="row" style={{ alignItems: "flex-start" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={settings.autoSuggestChoices}
              onChange={(e) => update({ autoSuggestChoices: e.target.checked })}
            />
            <span>
              Suggest choices after writing{" "}
              <small>
                (when the AI finishes a chapter, it also offers a few choices for the ending, using the suggestions
                model. This is one extra request each time.)
              </small>
            </span>
          </label>

          <div className="row">
            <button type="button" className="secondary" onClick={tryIt} disabled={trying}>
              {trying ? "Generating…" : "Try a sample reply"}
            </button>
            <PromptButton label="Try a sample reply" note="Sent to your default model." build={() => SAMPLE_REQUEST} />
            {trying && (
              <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            )}
          </div>
          {status && <p className={status.kind}>{status.text}</p>}
          {reply && <blockquote className="sample">{reply}</blockquote>}
        </section>
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
        <p className="meta">The exported file contains your API keys. Keep it private.</p>
      </section>
    </div>
  );
}
