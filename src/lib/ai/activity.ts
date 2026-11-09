// The AI calls this browser tab is making now (summaries, picture prompts, codex checks and the other buttons that call
// the model from the page), with what each is doing and the model's thinking so far, for the header's activity line
// and the step line under a button. `streamChat` reports to it; on the server nothing listens, so it costs nothing.
// It lives on globalThis for the same reason as the prompt recorder: the module can be loaded more than once.

export type AiCallActivity = {
  id: number;
  /** The call's source label ("Summary", "Cover prompt"). */
  label: string;
  /** What it is doing ("Waiting for the model…", "The model is thinking…", "The model is answering…"), and since when. */
  step: string;
  since: number;
  /** The model's reasoning so far, for models that think before they answer. */
  thinking: string;
};

type Store = { calls: AiCallActivity[]; listeners: Set<() => void>; next: number; lastTold: number; timer: ReturnType<typeof setTimeout> | null };
const holder = globalThis as unknown as { __storytimeAiActivity?: Store };
const store = (): Store => (holder.__storytimeAiActivity ??= { calls: [], listeners: new Set(), next: 1, lastTold: 0, timer: null });

/** Thinking comes in many small pieces: listeners hear of it at most this often. */
const TELL_MS = 250;

function tell(now = false) {
  const s = store();
  if (s.listeners.size === 0) return;
  const run = () => {
    s.timer = null;
    s.lastTold = Date.now();
    for (const l of s.listeners) l();
  };
  if (now || Date.now() - s.lastTold >= TELL_MS) {
    if (s.timer) clearTimeout(s.timer);
    run();
  } else if (!s.timer) {
    s.timer = setTimeout(run, TELL_MS);
  }
}

function change(id: number, patch: Partial<AiCallActivity>, now = true) {
  const s = store();
  s.calls = s.calls.map((c) => (c.id === id ? { ...c, ...patch } : c));
  tell(now);
}

/** Called by `streamChat` when a call starts; answers what the call reports to as it goes. */
export function startActivity(label: string) {
  const s = store();
  const id = s.next++;
  s.calls = [...s.calls, { id, label, step: "Starting…", since: Date.now(), thinking: "" }];
  tell(true);
  let current = "Starting…";
  const step = (text: string) => {
    if (text === current) return;
    current = text;
    change(id, { step: text, since: Date.now() });
  };
  let thinking = "";
  let answering = false;
  return {
    status: step,
    thinking(piece: string) {
      if (!thinking) step("The model is thinking…");
      thinking += piece;
      change(id, { thinking }, false);
    },
    text() {
      if (answering) return;
      answering = true;
      step("The model is answering…");
    },
    end() {
      s.calls = s.calls.filter((c) => c.id !== id);
      tell(true);
    },
  };
}

/** The calls going now, oldest first. Each change makes a new array, so it can be used as React state. */
export function activeCalls(): AiCallActivity[] {
  return store().calls;
}

export function subscribeActivity(listener: () => void): () => void {
  const s = store();
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}
