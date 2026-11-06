// The import of a story from text (New story › Import a story) on the server. It is a queue item of the Generate
// kind (`gen:import:<id>`, with `request.kind` "import"), so the queue lists it, takes turns with the writing, and can
// stop it; `runImport` is what the loop calls when its turn comes. Its work and the plan it makes are kept in the
// import's draft (`import:<id>`), which the review page reads.
import { completeChat } from "../ai/client";
import { parseChoices } from "../ai/prompts";
import { getDraft, putDraft } from "../draftStore";
import { LIMITS } from "../limits";
import { getSettings } from "../settingsStore";
import { parseSettings } from "../settingsSchema";
import {
  alternativesPrompt, chapterBody, chapterRanges, detailsPrompt, fallbackSplit, mergeShort, openingText, parseDetails, parseSplit,
  splitPrompt, SYSTEM_ALTERNATIVES, SYSTEM_DETAILS, SYSTEM_SPLIT, windowEnd, windowWords,
  type ImportDraft, type PlanChapter, type SplitEntry,
} from "../textImport";
import { workerState } from "./bus";
import { genItemKey } from "./generate";
import { createItem, deleteItem, getItem, updateItem, type WorkRow } from "./items";

/** A Generate item that is an import. */
export const isImportItem = (item: WorkRow) => item.type === "generate" && (item.data.request as { kind?: unknown } | undefined)?.kind === "import";

/** Queues the import whose draft is `draftKey`. One already waiting or going is left alone. */
export function startImport(draft: Pick<ImportDraft, "key" | "href" | "label">): WorkRow<"generate"> {
  const itemKey = genItemKey(draft.key);
  const existing = getItem(itemKey);
  if (existing && (existing.state === "waiting" || existing.state === "working")) return existing as WorkRow<"generate">;
  if (existing) deleteItem(itemKey);
  return createItem({ key: itemKey, type: "generate", state: "waiting", data: { draftKey: draft.key, href: draft.href, label: draft.label, request: { kind: "import" } } });
}

/** Changes the import's draft, reading it again if it was saved meanwhile. Null when the draft is gone. */
export function patchImportDraft(key: string, change: (d: ImportDraft) => Partial<ImportDraft>): ImportDraft | null {
  for (let attempt = 0; attempt < 5; attempt++) {
    const stored = getDraft(key) as ImportDraft | null;
    if (!stored) return null;
    const next = { ...stored, ...change(stored) };
    const saved = putDraft(key, next as unknown as Record<string, unknown>, { base: stored.updatedAt });
    if (saved.ok) return { ...next, updatedAt: saved.updatedAt };
  }
  throw new Error("The import's draft kept changing while it was saved.");
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const norm = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’.!?]+/g, " ").trim();

/**
 * One import: find the chapter breaks a part of the story at a time, suggest other choices at each break, then
 * write the story's summary and style notes. The draft goes to `ready` (or `failed`); the item to `done` or `failed`,
 * and a stopped one is removed.
 */
export async function runImport(draftKey: string): Promise<void> {
  const itemKey = genItemKey(draftKey);
  const item = getItem(itemKey);
  if (!item || item.type !== "generate" || workerState().generates.has(draftKey)) return;
  const draft = getDraft(draftKey) as ImportDraft | null;
  if (!draft || draft.kind !== "import") {
    updateItem(itemKey, { state: "failed", data: { error: "The text for this import is gone." } });
    return;
  }
  const settings = getSettings() ?? parseSettings({});
  const run: { text: string; ctl: AbortController } = { text: "", ctl: new AbortController() };
  workerState().generates.set(draftKey, run);
  updateItem(itemKey, { state: "working", data: { note: undefined, error: undefined } });
  const signal = run.ctl.signal;
  const opts = draft.options;
  const P = draft.paragraphs;
  const n = P.length;
  const ask = (label: string, system: string, content: string, maxTokens: number) =>
    completeChat(settings, { system, messages: [{ role: "user", content }], role: "main", model: opts.model, maxTokens, signal, source: { label, itemKey } });
  const progress = (text: string, extra: Partial<ImportDraft> = {}) => {
    patchImportDraft(draftKey, () => ({ status: "splitting", progress: text, error: undefined, ...extra }));
    updateItem(itemKey, { data: { note: text } });
  };
  const toChapters = (entries: SplitEntry[]): PlanChapter[] =>
    entries.map((e, i) => {
      const start = i === 0 ? 0 : entries[i - 1].end;
      return { start, title: draft.headings[start] || e.title || `Chapter ${i + 1}`, choice: e.choice, alternatives: [] };
    });

  try {
    // 1. The breaks, one part of the story at a time. A part that stops mid-story leaves out its last chapter,
    // which may have been cut off: the next part starts after the chapter before it.
    const words = windowWords(settings.contextTokens);
    let entries: SplitEntry[] = [];
    let from = 0;
    let part = 1;
    while (from < n) {
      const to = windowEnd(P, from, words);
      const last = to === n;
      const several = part > 1 || !last;
      progress(several ? `Finding the chapter breaks (part ${part})` : "Finding the chapter breaks", entries.length ? { plan: { title: "", premise: "", style: "", chapters: toChapters(entries) } } : {});
      const prompt = splitPrompt({ paragraphs: P, from, to, minWords: opts.minWords, maxWords: opts.maxWords, breaks: draft.breaks, last });
      let got: SplitEntry[] | null = null;
      // Small models sometimes break the format: one more go, then breaks by length.
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        got = parseSplit(await ask("Import: chapter breaks", SYSTEM_SPLIT, prompt, 3000), from, to);
      }
      if (!got) got = fallbackSplit(P, from, to, opts.minWords, opts.maxWords, draft.breaks).map((end) => ({ end, title: "", choice: "" }));
      if (!last && got.length > 1) got.pop();
      if (last && got[got.length - 1].end !== n) got.push({ end: n, title: "", choice: "" });
      entries.push(...got);
      from = got[got.length - 1].end;
      part++;
    }
    entries = mergeShort(P, entries, 0, opts.minWords);
    const chapters = toChapters(entries);
    chapters[chapters.length - 1].choice = "";
    const ranges = chapterRanges(chapters, n);

    // 2. Other choices at each break, and other endings after the last chapter.
    if (opts.alternatives > 0) {
      for (let i = 0; i < chapters.length; i++) {
        progress(`Suggesting other choices (chapter ${i + 1} of ${chapters.length})`, { plan: { title: "", premise: "", style: "", chapters } });
        const c = chapters[i];
        const before = chapters.slice(Math.max(0, i - 6), i).map((p) => `- ${p.title}; then: ${p.choice}`).join("\n");
        const prompt = alternativesPrompt({
          storyTitle: draft.textTitle ?? "",
          storySoFar: before,
          chapter: { title: c.title, body: chapterBody(P, ranges[i]) },
          original: c.choice || null,
          count: opts.alternatives,
        });
        try {
          const found = parseChoices(await ask("Import: other choices", SYSTEM_ALTERNATIVES, prompt, 500));
          const seen = new Set([norm(c.choice)]);
          c.alternatives = found
            .map((label) => label.slice(0, LIMITS.label))
            .filter((label) => {
              const k = norm(label);
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .slice(0, opts.alternatives)
            .map((label) => ({ label, keep: true }));
        } catch (e) {
          // One chapter without suggestions doesn't stop the import; they can be added in the review.
          if (isAbort(e)) throw e;
        }
      }
    }

    // 3. The story's title (when the text has none), summary and style notes.
    progress("Writing the summary and style notes", { plan: { title: "", premise: "", style: "", chapters } });
    let details = { title: "", premise: "", style: "" };
    try {
      details = parseDetails(await ask("Import: story details", SYSTEM_DETAILS, detailsPrompt(openingText(P, 1200), !draft.textTitle), 800));
    } catch (e) {
      if (isAbort(e)) throw e;
    }
    const title = draft.textTitle || details.title || "Untitled story";
    patchImportDraft(draftKey, () => ({
      status: "ready",
      progress: undefined,
      error: undefined,
      storyTitle: title,
      label: `Import: ${title}`,
      plan: { title, premise: details.premise, style: details.style, chapters },
    }));
    updateItem(itemKey, { state: "done", data: { note: undefined } });
  } catch (e) {
    const message = isAbort(e) ? "Stopped before it finished. Split it again to carry on." : e instanceof Error ? e.message : String(e);
    try {
      patchImportDraft(draftKey, () => ({ status: "failed", progress: undefined, error: message }));
    } catch {
      // the draft is gone or busy; the item still says what happened
    }
    if (isAbort(e)) deleteItem(itemKey);
    else updateItem(itemKey, { state: "failed", data: { error: message, note: undefined } });
  } finally {
    workerState().generates.delete(draftKey);
  }
}
