// Browser-side ComfyUI client. Like the text models, requests go straight from the browser to
// ComfyUI, so ComfyUI must allow this site's origin (start it with --enable-cors-header <origin>)
// and, when StoryTime is served over https, be on https too.
import type { Workflow } from "./workflow";

export class ComfyError extends Error {}

export type ComfyImage = { filename: string; subfolder: string; type: string };

export type Progress =
  | { stage: "queued"; ahead: number | null }
  | { stage: "running"; value: number; max: number }
  | { stage: "loading" };

const base = (url: string) => url.trim().replace(/\/+$/, "");

/** Says why ComfyUI couldn't be reached, as far as the browser lets us know. */
function unreachable(url: string): ComfyError {
  const origin = typeof location === "undefined" ? "this site's address" : location.origin;
  if (typeof location !== "undefined" && location.protocol === "https:" && url.startsWith("http:")) {
    return new ComfyError(`This page is on https, so the browser won't connect to ComfyUI over plain http (${url}). Put ComfyUI on https.`);
  }
  return new ComfyError(
    `Couldn't reach ComfyUI at ${url}. Check the address, and that ComfyUI was started with --enable-cors-header ${origin} so it accepts requests from StoryTime.`,
  );
}

async function call(url: string, path: string, init?: RequestInit): Promise<Response> {
  const root = base(url);
  if (!root) throw new ComfyError("No ComfyUI address is set. Add it in Settings.");
  let res: Response;
  try {
    res = await fetch(`${root}${path}`, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw unreachable(root);
  }
  return res;
}

async function json<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const res = await call(url, path, init);
  if (!res.ok) throw new ComfyError(`ComfyUI answered ${res.status} for ${path}.`);
  return (await res.json()) as T;
}

/** ComfyUI's version, as a connection test. */
export async function comfyVersion(url: string): Promise<string> {
  const stats = await json<{ system?: { comfyui_version?: string } }>(url, "/system_stats");
  return stats.system?.comfyui_version ?? "unknown version";
}

/** The checkpoint files ComfyUI has. */
export async function listCheckpoints(url: string): Promise<string[]> {
  const res = await call(url, "/models/checkpoints");
  if (res.ok) {
    const list = await res.json().catch(() => null);
    if (Array.isArray(list)) return list.filter((x): x is string => typeof x === "string");
  }
  // Older ComfyUI: read the loader node's choices.
  const info = await json<Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>>(url, "/object_info/CheckpointLoaderSimple");
  const choices = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  const options = Array.isArray(choices) ? choices : (info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[1] as { options?: unknown[] })?.options;
  return Array.isArray(options) ? options.filter((x): x is string => typeof x === "string") : [];
}

type NodeErrors = Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }>;

/** Explains a refused workflow in one line. */
function refusal(body: { error?: { message?: string; details?: string }; node_errors?: NodeErrors }): string {
  const nodes = Object.entries(body.node_errors ?? {}).flatMap(([id, n]) =>
    (n.errors ?? []).map((e) => `${n.class_type ?? "node"} ${id}: ${e.message ?? ""}${e.details ? ` (${e.details})` : ""}`),
  );
  return [body.error?.message ?? "ComfyUI refused the workflow.", ...nodes].join(" · ");
}

/** Queues the workflow; returns its prompt id. */
export async function queuePrompt(url: string, workflow: Workflow, clientId: string): Promise<string> {
  const res = await call(url, "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ComfyError(refusal(body));
  if (typeof body.prompt_id !== "string") throw new ComfyError("ComfyUI didn't say which job it queued.");
  return body.prompt_id;
}

type HistoryEntry = {
  outputs?: Record<string, { images?: ComfyImage[] }>;
  status?: { completed?: boolean; status_str?: string; messages?: [string, { exception_message?: string }][] };
};

/** The finished job's pictures, or null while it is still queued or running. Throws if it failed. */
async function finished(url: string, promptId: string): Promise<ComfyImage[] | null> {
  const history = await json<Record<string, HistoryEntry>>(url, `/history/${encodeURIComponent(promptId)}`);
  const entry = history[promptId];
  if (!entry) return null;
  if (entry.status?.status_str === "error") {
    const why = entry.status.messages?.find(([kind]) => kind === "execution_error")?.[1].exception_message;
    throw new ComfyError(`ComfyUI couldn't make the pictures${why ? `: ${why.trim()}` : "."}`);
  }
  if (entry.status && !entry.status.completed) return null;
  const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
  // Saved pictures if there are any, otherwise previews.
  const saved = images.filter((i) => i.type === "output");
  return saved.length ? saved : images;
}

/**
 * Waits for a queued job and returns its pictures. Progress comes over ComfyUI's WebSocket; the
 * job's history is also checked every couple of seconds, so a lost connection only loses progress.
 */
export function waitForPictures(
  url: string,
  promptId: string,
  clientId: string,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<ComfyImage[]> {
  const root = base(url);
  return new Promise((resolve, reject) => {
    let done = false;
    let started = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (err: unknown, images?: ComfyImage[]) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(images!);
    };
    const onAbort = () => finish(new DOMException("Stopped", "AbortError"));
    signal?.addEventListener("abort", onAbort);

    const check = async () => {
      if (done) return;
      try {
        const images = await finished(root, promptId);
        if (images) return finish(null, images);
      } catch (e) {
        if (e instanceof ComfyError && /couldn't make/.test(e.message)) return finish(e);
        // A failed check is retried; the WebSocket may still report the result.
      }
      if (!done) timer = setTimeout(check, 2000);
    };

    try {
      socket = new WebSocket(`${root.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
      socket.onmessage = (ev) => {
        if (typeof ev.data !== "string") return; // binary frames are live previews
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const d = msg.data ?? {};
        if (msg.type === "status") {
          // The queue length counts this job too, until it starts.
          const ahead = (d.status as { exec_info?: { queue_remaining?: number } } | undefined)?.exec_info?.queue_remaining;
          if (!started && typeof ahead === "number") onProgress({ stage: "queued", ahead: Math.max(0, ahead - 1) });
          return;
        }
        if (d.prompt_id !== promptId) return;
        started = true;
        if (msg.type === "progress" && typeof d.value === "number" && typeof d.max === "number") {
          onProgress({ stage: "running", value: d.value, max: d.max });
        } else if (msg.type === "execution_error") {
          finish(new ComfyError(`ComfyUI couldn't make the pictures: ${String(d.exception_message ?? "unknown error").trim()}`));
        } else if (msg.type === "execution_interrupted") {
          finish(new DOMException("Stopped", "AbortError"));
        } else if (msg.type === "execution_success" || (msg.type === "executing" && d.node === null)) {
          onProgress({ stage: "loading" });
          void check();
        }
      };
    } catch {
      socket = null; // fall back to checking the history only
    }
    onProgress({ stage: "queued", ahead: null });
    timer = setTimeout(check, 1000);
  });
}

/** Stops the job: removes it from the queue, or interrupts it if it is running. */
export async function cancelPrompt(url: string, promptId: string): Promise<void> {
  const post = (path: string, body: unknown) =>
    call(url, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  await post("/queue", { delete: [promptId] });
  await post("/interrupt", { prompt_id: promptId });
}

/** Where the browser can load one of ComfyUI's pictures from. */
export function imageUrl(url: string, image: ComfyImage): string {
  const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
  return `${base(url)}/view?${q}`;
}

/** Downloads one of ComfyUI's pictures, to save it in StoryTime. */
export async function fetchImage(url: string, image: ComfyImage): Promise<Blob> {
  const res = await call(url, `/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })}`);
  if (!res.ok) throw new ComfyError(`ComfyUI couldn't send the picture (${res.status}).`);
  return res.blob();
}
