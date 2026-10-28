// AI helper for "turn notes into facts": the AI reads the author's free-text notes about one codex entry and splits them
// into small lasting facts (and the entry's current form, when the notes give one). They go to the codex inbox with
// source "notes", and the quote of each is words from the notes. Pure apart from `completeChat`; runs on the server.
import { completeChat } from "./client";
import { estimateTokens, type PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import { quoteInText } from "./tagAi";
import { FACT_LIMITS, STARTER_ASPECTS, isFormAspect, sameAspect, type CodexEntry } from "../codex";
import type { SuggestionInput } from "./codexCheckAi";
import type { Settings } from "../settings";

export const MAX_NOTE_FACTS = 12;

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lc = (s: string) => s.trim().toLowerCase();

const SYSTEM_NOTES_TO_FACTS = `You keep the codex of a story up to date. The codex records the lasting state of the story's characters, places and things as small facts, one per aspect, for example "Ears: tall russet fox ears". The author has written free-text notes about one codex entry. Split those notes into facts.

How to write a fact:
- One fact per aspect, in the present tense, short (under about 25 words) and standalone: use names, not pronouns.
- Only what stays true. Skip plot events, plans, feelings in the moment and anything the author is unsure of.
- Reuse the aspect names already on the entry when they fit. Otherwise use a short title-case name. For a character, the usual aspects are: ${STARTER_ASPECTS.character.join(", ")}.
- Skip anything the entry already has as a fact.

Kinds of item:
- "set": a fact. Give "aspect", "text" and, only if it belongs to one form of the character, "form" (otherwise leave it empty).
- "form": the notes say what form or stage the character is in now. Give "form" (the form's name, such as "vixen" or "half-changed") and "text" (a short note about it, or empty).

Rules:
- Every item needs "quote": the exact words copied from the notes that it comes from (under 200 characters).
- Do not guess. At most ${MAX_NOTE_FACTS} items.
Reply with JSON only, in this shape ({"facts":[]} if there is nothing to add):
{"facts":[{"kind":"set|form","aspect":"","form":"","text":"","quote":""}]}`;

export type NotesToFactsOptions = { entry: CodexEntry };

/** The entry as the AI sees it: its name and type, what it has as facts now, and the whole of its notes. */
function describeForNotes(e: CodexEntry): { known: string; notes: string } {
  const lines: string[] = [];
  if (e.form) {
    const label = [e.form.name, e.form.note].map((s) => s.trim()).filter(Boolean).join(", ");
    if (label) lines.push(`Current form: ${label}`);
  }
  for (const f of e.facts) {
    if (isFormAspect(f.aspect) || !f.text.trim()) continue;
    lines.push(`- ${f.aspect.trim() || "(note)"} [${f.form.trim() ? `${f.form.trim()} form` : "every form"}]: ${f.text.trim()}`);
  }
  return { known: lines.join("\n"), notes: e.content.trim() };
}

/** The request for one entry's notes. Notes too long for the context are cut to fit. */
export function notesToFactsRequest(contextTokens: number, opts: NotesToFactsOptions): PromptParts {
  const { entry } = opts;
  const { known, notes } = describeForNotes(entry);
  const budget = Math.max(1000, contextTokens - 2000 - estimateTokens(SYSTEM_NOTES_TO_FACTS) - estimateTokens(known));
  const maxChars = budget * 2;
  const cut = notes.length > maxChars ? `${notes.slice(0, maxChars)}…` : notes;
  const message = [
    `The entry: ${entry.name} [${entry.type}]${entry.aliases.length ? ` (also: ${entry.aliases.join(", ")})` : ""}`,
    `Its facts now:\n${known || "(none yet)"}`,
    `The author's notes:\n${cut}`,
    "Turn the notes into facts, as JSON.",
  ].join("\n\n");
  return { system: SYSTEM_NOTES_TO_FACTS, message };
}

/** Turns a model reply into suggestions for the entry, dropping what can't be trusted (a quote not in the notes, no change). */
export function parseNotesToFacts(reply: string, opts: NotesToFactsOptions): SuggestionInput[] {
  const raw = extractJson(reply);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? ((raw as { facts?: unknown; changes?: unknown }).facts ?? (raw as { changes?: unknown }).changes) : null;
  if (!Array.isArray(list)) return [];
  const { entry } = opts;
  const live = (a: string, f: string) => entry.facts.find((x) => !isFormAspect(x.aspect) && sameAspect(x.aspect, a) && sameAspect(x.form, f));

  const out: SuggestionInput[] = [];
  for (const item of list) {
    if (out.length >= MAX_NOTE_FACTS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let kind = lc(asString(o.kind, 20));
    if (kind === "") kind = "set";
    if (kind !== "set" && kind !== "form") continue;
    const quote = asString(o.quote, FACT_LIMITS.quote);
    if (!quote || !quoteInText(quote, entry.content)) continue;
    let aspect = asString(o.aspect, FACT_LIMITS.aspect);
    let form = asString(o.form, FACT_LIMITS.form);
    const text = asString(o.text, FACT_LIMITS.text);
    // A "set" of the aspect "form" is a form change.
    if (kind === "set" && isFormAspect(aspect)) kind = "form";

    if (kind === "form") {
      if (!form) continue;
      if (entry.form && sameAspect(entry.form.name, form) && lc(entry.form.note) === lc(text)) continue;
      if (out.some((x) => x.kind === "form")) continue; // an entry is in one form at a time
      out.push({ kind: "form", entry_id: entry.entry_id, aspect: "", form, after: text, quote });
    } else {
      if (!aspect || !text) continue;
      const have = live(aspect, form);
      if (have && lc(have.text) === lc(text)) continue;
      aspect = have?.aspect ?? aspect; // keep the entry's own spelling of the aspect
      form = have?.form ?? form;
      if (out.some((x) => x.kind === "set" && sameAspect(x.aspect, aspect) && sameAspect(x.form, form))) continue;
      out.push({ kind: "set", entry_id: entry.entry_id, aspect, form, after: text, quote });
    }
  }
  return out;
}

export type RunNotesToFactsOptions = NotesToFactsOptions & { signal?: AbortSignal; role?: "main" | "cheap" };

/** Asks the AI for the facts in one entry's notes. Throws when the reply can't be read. */
export async function runNotesToFacts(settings: Settings, opts: RunNotesToFactsOptions): Promise<SuggestionInput[]> {
  if (!opts.entry.content.trim()) return [];
  const request = notesToFactsRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: opts.role ?? "cheap",
    signal: opts.signal,
  });
  return parseNotesToFacts(reply, opts);
}
