// Generate on the server: the chapter the writing page asked for, written into the draft whether or not any page is
// open. The request is kept in the item (`gen:<draft key>`); `runGenerate` is what the loop calls when its turn comes.
// The text so far goes out on the bus channel `gen:<draft key>` (D11) for pages that are watching, and is saved into the
// draft every few seconds and at the end.
import { z } from "zod";
import { completeChat, streamChat } from "../ai/client";
import {
  choiceLabelPrompt, choicesPrompt, generatePrompt, parseChapterOutput, parseChoiceLabel, parseChoices, SYSTEM_CHAPTER, SYSTEM_CHOICE_LABEL, SYSTEM_CHOICES,
  type StoryContext,
} from "../ai/prompts";
import { withPathSummaries } from "../aiRuns/writeChapter";
import type { Draft } from "../drafts";
import { getDraft, putDraft } from "../draftStore";
import { applyAfterGenerate, applyGenerated, isBegun } from "../generatedDraft";
import { LIMITS } from "../limits";
import { getSettings } from "../settingsStore";
import { parseSettings } from "../settingsSchema";
import { publish, workerState } from "./bus";
import { createItem, deleteItem, getItem, updateItem, type WorkRow } from "./items";
import { selfFetch } from "./selfFetch";

const modelRef = z.object({ connectionId: z.string(), model: z.string() }).nullable();
const draftText = z.object({ title: z.string(), body: z.string() });

/** The most the story so far (`ctx`) may be, as JSON. */
const MAX_CTX_CHARS = 4_000_000;

/** What the writing page asks to be generated: everything the request needs, so it can finish with the page gone. */
export const generateRequest = z.object({
  /** The draft's key (`fill:<choice id>` and so on): one Generate per draft. */
  key: z.string().min(1).max(200),
  /** Where the draft is written, for Open. */
  href: z.string().max(500),
  label: z.string().max(500),
  /** The story so far, as `StoryContext`; checked by the prompt code that reads it. */
  ctx: z.record(z.string(), z.unknown()).refine((c) => JSON.stringify(c).length <= MAX_CTX_CHARS, "The story is too large"),
  direction: z.string().max(100_000),
  length: z.enum(["short", "medium", "long"]),
  model: modelRef,
  suggestModel: modelRef,
  /** After the chapter: make the choice text for the previous chapter, and suggest choices for this one. */
  after: z.object({ choiceText: z.boolean(), suggestChoices: z.boolean() }),
  /** The draft's title and text when it started, which applying the new text keeps as the previous version. */
  base: draftText,
  /** The draft as the page has it, to start from when the server has none saved yet. */
  draft: z.record(z.string(), z.unknown()),
});
export type GenerateRequest = Omit<z.infer<typeof generateRequest>, "ctx" | "draft"> & { ctx: StoryContext; draft: Draft };

export type GenerateAfter = { choiceLabel?: string; suggestions?: string[] };

/** What a page watching a Generate is sent on `gen:<draft key>`. */
export type GenerateEvent =
  | { type: "text"; text: string; base: { title: string; body: string } }
  | { type: "done"; after: GenerateAfter }
  | { type: "stopped" }
  | { type: "error"; message: string };

export const genItemKey = (draftKey: string) => `gen:${draftKey}`;
export const genChannel = genItemKey;

/** The text so far is sent to pages watching at most this often. */
const TEXT_MS = 250;

/** The draft was changed by someone else twice while the text was being put into it. */
class DraftChanged extends Error {
  constructor() {
    super("The draft was changed elsewhere; the generated text is kept in the list.");
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Asks for a Generate: an item in `waiting`. One already waiting or going is left alone and returned. */
export function startGenerate(input: z.infer<typeof generateRequest>): WorkRow<"generate"> {
  const itemKey = genItemKey(input.key);
  const existing = getItem(itemKey);
  if (existing && (existing.state === "waiting" || existing.state === "working")) return existing as WorkRow<"generate">;
  if (existing) deleteItem(itemKey);
  return createItem({ key: itemKey, type: "generate", state: "waiting", data: { draftKey: input.key, href: input.href, label: input.label, request: input } });
}

/** Stops a Generate: one going is aborted (the text so far stays in the draft); one waiting is removed. False when there is none. */
export function stopGenerate(draftKey: string): boolean {
  const running = workerState().generates.get(draftKey);
  if (running) {
    running.ctl.abort();
    return true;
  }
  const item = getItem(genItemKey(draftKey));
  if (!item || item.state === "working") return false;
  return deleteItem(item.key);
}

/** The text so far of the Generate going now, for a page that starts watching. */
export function generateProgress(draftKey: string): GenerateEvent | null {
  const running = workerState().generates.get(draftKey);
  const item = getItem(genItemKey(draftKey));
  if (!running || item?.type !== "generate") return null;
  const request = item.data.request as GenerateRequest;
  return { type: "text", text: running.text, base: request.base };
}

/** Puts the text into the draft, once more if the draft changed meanwhile. */
function saveGenerated(req: GenerateRequest, text: string, after?: GenerateAfter) {
  for (let attempt = 0; ; attempt++) {
    const stored = getDraft(req.key) as (Draft & Record<string, unknown>) | null;
    const d: Draft = stored ?? { ...req.draft, key: req.key, updatedAt: 0 };
    let next = applyGenerated(d, parseChapterOutput(text), { continued: isBegun(d, req.base) });
    if (after) next = applyAfterGenerate(next, after);
    const saved = putDraft(req.key, next as unknown as Record<string, unknown>, { base: stored ? stored.updatedAt : null });
    if (saved.ok) return;
    if (attempt >= 1) throw new DraftChanged();
  }
}

/**
 * One Generate: summarize the story so far if the prompt needs it, stream the chapter, then the choice text and
 * suggested choices. The item goes to `working`, then `done` or `failed`; a Generate that is stopped is removed.
 */
export async function runGenerate(draftKey: string): Promise<void> {
  const itemKey = genItemKey(draftKey);
  const item = getItem(itemKey);
  if (!item || item.type !== "generate" || workerState().generates.has(draftKey)) return;
  if (!generateRequest.safeParse(item.data.request).success) {
    updateItem(itemKey, { state: "failed", data: { error: "The request for this Generate is not valid." } });
    return;
  }
  const req = item.data.request as GenerateRequest;
  const settings = getSettings() ?? parseSettings({});
  const run = { text: "", ctl: new AbortController() };
  workerState().generates.set(draftKey, run);
  updateItem(itemKey, { state: "working", data: { note: undefined, error: undefined, text: undefined } });
  const tell = (event: GenerateEvent) => publish(genChannel(draftKey), event);
  let lastSave = 0;
  let lastTold = 0;
  try {
    const ready = await withPathSummaries(settings, req.ctx, run.ctl.signal, undefined, selfFetch);
    const message = generatePrompt(ready, req.direction, req.length, settings.contextTokens);
    for await (const piece of streamChat(settings, { system: SYSTEM_CHAPTER, messages: [{ role: "user", content: message }], role: "main", model: req.model, signal: run.ctl.signal })) {
      run.text += piece;
      // The text so far goes out at most four times a second (the end sends it whole, below).
      if (Date.now() - lastTold >= TEXT_MS) {
        lastTold = Date.now();
        tell({ type: "text", text: run.text, base: req.base });
      }
      if (Date.now() - lastSave > 3000) {
        lastSave = Date.now();
        saveGenerated(req, run.text);
      }
    }
    const chapter = parseChapterOutput(run.text);
    const after: GenerateAfter = {};
    if (chapter.body.trim()) {
      const shown = { title: chapter.title ?? "", body: chapter.body };
      if (req.after.choiceText) {
        try {
          const reply = await completeChat(settings, {
            system: SYSTEM_CHOICE_LABEL,
            messages: [{ role: "user", content: choiceLabelPrompt({ ...ready, choiceLabel: null }, shown, settings.contextTokens) }],
            role: "cheap", model: req.suggestModel, maxTokens: 60, signal: run.ctl.signal,
          });
          const label = parseChoiceLabel(reply).slice(0, LIMITS.label);
          if (label) after.choiceLabel = label;
        } catch (e) {
          if (isAbort(e)) throw e;
        }
      }
      if (req.after.suggestChoices) {
        try {
          const reply = await completeChat(settings, {
            system: SYSTEM_CHOICES,
            messages: [{ role: "user", content: choicesPrompt(ready, shown, [], settings.contextTokens) }],
            role: "cheap", model: req.suggestModel, maxTokens: 400, signal: run.ctl.signal,
          });
          const found = parseChoices(reply);
          if (found.length) after.suggestions = found;
        } catch (e) {
          if (isAbort(e)) throw e;
        }
      }
    }
    saveGenerated(req, run.text, after);
    tell({ type: "text", text: run.text, base: req.base });
    tell({ type: "done", after });
    updateItem(itemKey, { state: "done" });
  } catch (e) {
    if (isAbort(e)) {
      // Stopped: what was written stays in the draft.
      if (run.text) {
        try {
          saveGenerated(req, run.text);
        } catch {
          // the draft changed; the stop still stands
        }
      }
      deleteItem(itemKey);
      tell({ type: "stopped" });
    } else {
      let message = e instanceof Error ? e.message : String(e);
      if (run.text && !(e instanceof DraftChanged)) {
        try {
          saveGenerated(req, run.text);
        } catch (saveError) {
          if (saveError instanceof DraftChanged) e = saveError;
        }
      }
      if (e instanceof DraftChanged) message = e.message;
      tell({ type: "error", message });
      updateItem(itemKey, { state: "failed", data: { error: message, ...(e instanceof DraftChanged && { text: run.text }) } });
    }
  } finally {
    workerState().generates.delete(draftKey);
  }
}
