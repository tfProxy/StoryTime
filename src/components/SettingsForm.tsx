"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PROVIDERS, providerInfo, type ProviderKind } from "@/lib/ai/providers";
import { AiError, listModels, streamChat } from "@/lib/ai/client";
import PromptButton from "./PromptButton";
import ComfyConnection from "./ComfyConnection";
import { DrawingSettings, EditSettings, usePictureSetup } from "./PictureSettings";
import { EDIT_MODEL_IDS } from "@/lib/comfy/editModels";
import {
  exportSettingsJson,
  favoriteFor,
  favoritesFor,
  findConnection,
  importSettingsJson,
  MODEL_USES,
  modelLabel,
  newConnection,
  newFavorite,
  parseRefKey,
  refKey,
  removeConnection,
  sameRef,
  saveSettings,
  useSettings,
  type Connection,
  type Favorite,
  type ModelRef,
  type ModelUse,
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

/**
 * The Settings tabs. Each is at /settings#<id>; a link to something inside one (#models, a preset's
 * #preset-<id>) opens it too. `holds` also keeps links from before presets working.
 */
const TABS = [
  { id: "connections", label: "Connections", holds: ["comfyui"] },
  { id: "writing", label: "Writing", holds: ["models"] },
  { id: "drawing", label: "Drawing", holds: ["setup-drawing", "drawing-presets", "pictures", "picture-setup", "redraw"] },
  { id: "edit-qwen-image-edit", label: "Qwen edit", holds: ["setup-qwen-image-edit", "qwen-image-edit-presets", "edit-loras"] },
  { id: "edit-flux-kontext", label: "Flux edit", holds: ["setup-flux-kontext", "flux-kontext-presets"] },
  { id: "backup", label: "Backup", holds: [] },
] as const;
type TabId = (typeof TABS)[number]["id"];

function tabFor(hash: string, comfy: Settings["comfy"]): TabId {
  const tab = TABS.find((t) => t.id === hash || (t.holds as readonly string[]).includes(hash));
  if (tab) return tab.id;
  if (hash.startsWith("preset-")) {
    const id = hash.slice("preset-".length);
    const edit = comfy.editPresets.find((p) => p.id === id);
    if (edit) return `edit-${edit.model}`;
    if (comfy.drawPresets.some((p) => p.id === id)) return "drawing";
  }
  return "connections";
}

const onHashChange = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
/** The page's #hash without the #; "" while rendering on the server. */
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(location.hash.slice(1)), () => "");

/** Opens a tab: its #hash goes in the address (without a new history entry), so a reload or a link comes back to it. */
function openTab(id: TabId) {
  history.replaceState(null, "", `#${id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

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
      <label className="inline-label">
        <input type="checkbox" checked={conn.freeComfy} onChange={(e) => onChange({ freeComfy: e.target.checked })} />
        Free ComfyUI&apos;s memory before each request
      </label>
      <small>
        For a model on the same machine as ComfyUI: ComfyUI unloads its models first, so this one has the
        graphics memory (pictures then take longer to start). Does nothing while no ComfyUI address is set
        below.
      </small>
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

/** One starred model's settings: nickname, thinking, and the jobs it is offered for. */
function ModelCard({
  fav,
  settings,
  onChange,
  onRemove,
}: {
  fav: Favorite;
  settings: Settings;
  onChange: (patch: Partial<Favorite>) => void;
  onRemove: () => void;
}) {
  const conn = findConnection(settings, fav.connectionId);
  const offered = (u: ModelUse) => !fav.hiddenFrom.includes(u);
  const setOffered = (u: ModelUse, on: boolean) =>
    onChange({ hiddenFrom: on ? fav.hiddenFrom.filter((x) => x !== u) : [...fav.hiddenFrom, u] });
  return (
    <fieldset className="card model-card" aria-label={fav.label.trim() || fav.model}>
      <legend>
        <span style={{ overflowWrap: "anywhere" }}>{fav.model}</span>
        <span className="meta"> · {conn?.name || (conn ? providerInfo(conn.kind).label : "")}</span>
      </legend>
      <label>
        Nickname <small>(optional)</small>
        <input aria-label={`Nickname for ${fav.model}`} value={fav.label} onChange={(e) => onChange({ label: e.target.value })} />
      </label>
      <label className="inline-label">
        <input type="checkbox" checked={fav.disableThinking} onChange={(e) => onChange({ disableThinking: e.target.checked })} />
        Disable thinking
      </label>
      <fieldset className="model-uses">
        <legend>Offer this model for</legend>
        {MODEL_USES.map((u) => (
          <label key={u.id} className="inline-label">
            <input type="checkbox" checked={offered(u.id)} onChange={(e) => setOffered(u.id, e.target.checked)} />
            <span>
              {u.label} <small>({u.hint})</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button type="button" className="secondary" onClick={onRemove} aria-label={`Unstar ${fav.model}`}>
          Remove
        </button>
      </div>
    </fieldset>
  );
}

/** A default-model dropdown over the starred models offered for its job. */
function DefaultSelect({
  settings,
  value,
  use,
  blankLabel,
  onChange,
}: {
  settings: Settings;
  value: ModelRef | null;
  use: ModelUse;
  blankLabel: string;
  onChange: (ref: ModelRef | null) => void;
}) {
  const offered = favoritesFor(settings, use);
  const listed = !value || offered.some((f) => sameRef(f, value));
  // Still the default, but no longer offered for this job: say so rather than hide it.
  const why = value && favoriteFor(settings, value) ? " (not offered for this)" : "";
  return (
    <select value={value ? refKey(value) : ""} onChange={(e) => onChange(e.target.value ? parseRefKey(e.target.value) : null)}>
      <option value="">{blankLabel}</option>
      {value && !listed && <option value={refKey(value)}>{modelLabel(settings, value) + why}</option>}
      {offered.map((f) => (
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
  // The sample reply's outcome (Writing tab), an import's (Backup tab), and a failed save (shown on every tab).
  const [status, setStatus] = useState<Status | null>(null);
  const [importStatus, setImportStatus] = useState<Status | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [trying, setTrying] = useState(false);
  const [reply, setReply] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hash = useHash();
  const tab = tabFor(hash, settings.comfy);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const pictureSetup = usePictureSetup(settings.comfy);

  // A link to something inside a tab (#models, #preset-<id>) scrolls to it once its tab shows, and opens a preset's card.
  useEffect(() => {
    const el = hash ? document.getElementById(hash) : null;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: "start" });
  }, [hash, tab]);

  function save(next: Settings) {
    void saveSettings(next).then((saved) => setSaveFailed(!saved));
  }
  const update = (patch: Partial<Settings>) => save({ ...settings, ...patch });
  const updateComfy = (patch: Partial<Settings["comfy"]>) => update({ comfy: { ...settings.comfy, ...patch } });

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
        favorites: [...settings.favorites, newFavorite(ref)],
        defaults: settings.defaults.main ? settings.defaults : { ...settings.defaults, main: ref },
      });
    }
  }

  function updateFavorite(ref: ModelRef, patch: Partial<Favorite>) {
    update({ favorites: settings.favorites.map((f) => (sameRef(f, ref) ? { ...f, ...patch } : f)) });
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
      setImportStatus(saved ? { kind: "ok", text: "Settings imported." } : { kind: "error", text: "The server couldn't save the imported settings." });
    } catch (e) {
      setImportStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't read that file" });
    }
  }

  /** The tab bar's arrow keys move between tabs, as in other tab bars. */
  function onTabKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    openTab(t.id);
    tabRefs.current.get(t.id)?.focus();
  }

  // A panel's id isn't its tab's #hash, so opening /settings#pictures doesn't scroll the tabs out of view.
  const panel = (id: TabId) => ({ role: "tabpanel", id: `panel-${id}`, "aria-labelledby": `tab-${id}`, hidden: tab !== id, className: "settings-panel" });

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="settings-tabs" role="tablist" aria-label="Settings" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) tabRefs.current.set(t.id, el);
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => openTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {saveFailed && <p className="error">The server couldn&apos;t save the settings. Your changes will be lost on reload.</p>}

      <div {...panel("connections")}>
        <p className="notice">
          These settings, including your API keys, are stored on the StoryTime server and shared by every browser that
          uses it. AI requests still go directly from your browser to the provider you choose, so the key is sent to
          your browser when a page loads. Only use StoryTime on a server and network you trust.
        </p>
        <section className="settings-section">
          <h2>AI connections</h2>
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
        <ComfyConnection comfy={settings.comfy} onChange={(patch) => update({ comfy: { ...settings.comfy, ...patch } })} />
      </div>

      <div {...panel("writing")}>
        <section id="models" className="settings-section">
          <h2>Starred models</h2>
          {settings.favorites.length === 0 ? (
            <p className="meta">
              None yet. Test a connection on the{" "}
              <button type="button" className="link-button" onClick={() => openTab("connections")}>
                Connections tab
              </button>{" "}
              and star the models you want; they become the choices on the writing page.
            </p>
          ) : (
            <>
              <p className="meta">
                These are the models you can switch between while writing. Each is offered for every job unless you
                untick it, so a big model can be kept for chapters and out of the summary and suggestion pickers.
                Disable thinking asks a model to skip extended thinking, for faster and cheaper replies (sent as
                thinking: disabled to Anthropic, reasoning: {"{"}effort: none{"}"} to OpenRouter and reasoning_effort: none
                to others); leave it off for models that only work with thinking or reject it.
              </p>
              <div className="model-cards">
                {settings.favorites.map((f) => (
                  <ModelCard
                    key={refKey(f)}
                    fav={f}
                    settings={settings}
                    onChange={(patch) => updateFavorite(f, patch)}
                    onRemove={() => toggleFavorite(f)}
                  />
                ))}
              </div>
            </>
          )}

          <label>
            Default model <small>(for writing chapters; each draft can pick another)</small>
            <DefaultSelect
              settings={settings}
              value={settings.defaults.main}
              use="write"
              blankLabel="Choose a starred model…"
              onChange={(r) => update({ defaults: { ...settings.defaults, main: r } })}
            />
          </label>
          <label>
            Cheaper model <small>(for summaries, suggestions and small jobs; drafts can pick another for suggestions)</small>
            <DefaultSelect
              settings={settings}
              value={settings.defaults.cheap}
              use="summary"
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
      </div>

      <div {...panel("drawing")}>
        <DrawingSettings comfy={settings.comfy} setup={pictureSetup} onChange={updateComfy} onConnections={() => openTab("connections")} />
      </div>
      {EDIT_MODEL_IDS.map((m) => (
        <div key={m} {...panel(`edit-${m}`)}>
          <EditSettings modelId={m} comfy={settings.comfy} setup={pictureSetup} onChange={updateComfy} onConnections={() => openTab("connections")} />
        </div>
      ))}

      <section {...panel("backup")}>
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
        {importStatus && <p className={importStatus.kind}>{importStatus.text}</p>}
        <p className="meta">The exported file contains your API keys. Keep it private.</p>
      </section>
    </div>
  );
}
