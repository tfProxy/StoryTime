// AI helpers for the codex: draft or update a single entry (runs in the browser with the user's own key; nothing is
// saved until the user accepts and posts), and the JSON helpers other AI code shares. Reading chapters for codex
// changes is the codex check (codexCheckAi.ts), which runs on the server.
import { completeChat, type AiSourceIds } from "./client";
import { buildStorySoFar, estimateTokens, notesBlock, parseInstruction, type ContextChapter, type PromptParts } from "./prompts";
import { ENTRY_TYPES, type CodexEntry, type EntryType } from "../codex";
import type { Settings } from "../settings";

export type PathChapter = ContextChapter & { id: string; depth: number };

export type StoryInfo = { title: string; premise: string };

export type EntryFields = {
  name: string;
  type: EntryType;
  aliases: string[];
  content: string;
  always_include: boolean;
};

// ---------- JSON handling ----------

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The AI didn't return anything I could read. Try again.");
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new Error("The AI's reply wasn't valid JSON. Try again, or use a stronger model.");
  }
}

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function asType(v: unknown): EntryType {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (ENTRY_TYPES as readonly string[]).includes(t) ? (t as EntryType) : "note";
}

function asAliases(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => asString(a, 60))
    .filter(Boolean)
    .slice(0, 10);
}

export function parseFields(raw: unknown): EntryFields | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = asString(o.name, 100);
  if (!name) return null;
  return {
    name,
    type: asType(o.type),
    aliases: asAliases(o.aliases),
    content: asString(o.content, 8000),
    always_include: o.always_include === true,
  };
}

// ---------- the entry prompts ----------

// What makes a good entry. Used by the prompt below, because the model can't guess how the
// app uses entries: an entry is shown to a writer only when its name or an alias appears in the
// recent text (or it is "always include"), it competes for a small token budget, and it is read
// later as a single line with no other context.
const CODEX_GUIDE = `What makes a good entry:
- Purpose: an entry is shown to a writer when its name or one of its aliases appears in the recent text, so that they stay consistent with it. Write what a writer needs to know, not a summary of the plot.
- Content: facts that constrain future chapters. For a character: who they are, appearance, relationships, goals, secrets, and their current status (alive, injured, allied with whom, where). For a place or item: what it is, its rules or properties, and who holds or controls it. For a faction or lore: what it is and how it affects the story. Leave out atmosphere, flowery description and a retelling of events.
- Standalone: the entry is read as a single line without the chapter beside it, so name people and places explicitly (not "she" or "the village"), and never refer to chapters. Be brief; long entries may be left out to save space.
- Aliases: short names the story text actually uses for the thing (a nickname, title, surname, or spelling variant), so it is recognised when mentioned. Never generic words ("the man", "woman", "the") that would match unrelated text. Leave empty if there are none.
- Types: character (a person or creature), place (a location), item (an object), faction (a group or organisation), lore (history, magic, rules of the world), note (anything else, rarely).
- always_include: almost always false. True only for something every future chapter needs, such as the protagonist or a rule of the whole world.
Example of the style (illustrative; do not copy its details): {"name":"Harbour Master Oda","type":"character","aliases":["Oda","the Harbour Master"],"content":"Harbour master of Saltgate. Stern and observant; secretly pays the smugglers' guild to ignore certain ships. Distrusts the hero since the missing cargo.","always_include":false}`;

function describeCodex(entries: CodexEntry[]): string {
  if (entries.length === 0) return "(empty)";
  return entries
    .map((e) => `- ${e.name} [${e.type}]${e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : ""}: ${e.description.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

// ---------- drafting a single entry ----------

const SYSTEM_ENTRY = `You write entries for the codex (a reference list) of a branching story, so that writers keep facts consistent.
An entry has: a name, a type, aliases, a concise description (1-4 sentences, present tense, the current state of the thing), and always_include.
Use only facts from the story and the author's instructions; invent details only where asked to create something new.

${CODEX_GUIDE}

Reply with JSON only: {"name":"","type":"","aliases":[],"content":"","always_include":false}`;

export type DraftEntryOptions = {
  story: StoryInfo;
  path: PathChapter[];
  /** The live codex, so new entries don't duplicate existing ones. */
  codex: CodexEntry[];
  direction: string;
  /** Present when improving or updating an entry that already exists. */
  existing: EntryFields | null;
  /** "update" re-reads these chapters (those since the entry was last changed) to bring the entry up to date. */
  mode: "draft" | "update";
  /** Chapters to re-read in "update" mode, oldest first. */
  since?: PathChapter[];
  signal?: AbortSignal;
  source?: AiSourceIds;
};

export type DraftEntryResult = { fields: EntryFields; changedInChapterId: string | null };

/** The request for drafting or updating an entry; throws if there is nothing to ask yet. */
export function entryRequest(contextTokens: number, opts: Omit<DraftEntryOptions, "signal">): PromptParts {
  return buildEntry(contextTokens, opts).request;
}

function buildEntry(
  contextTokens: number,
  opts: Omit<DraftEntryOptions, "signal">,
): { request: PromptParts; numbered: PathChapter[] } {
  const budget = Math.max(1000, contextTokens - 1500);
  const parts: string[] = [`Story: ${opts.story.title}${opts.story.premise.trim() ? `\nPremise: ${opts.story.premise.trim()}` : ""}`];

  // "[...]" in what the author typed is extra instructions; with no other text, it is the request.
  const { text: direction, notes } = parseInstruction(opts.direction);
  let task: string;
  let numbered: PathChapter[] = [];
  if (opts.mode === "update") {
    if (!opts.existing) throw new Error("There's no entry to update yet.");
    numbered = opts.since ?? [];
    const sinceIds = new Set(numbered.map((c) => c.id));
    const before = opts.path.filter((c) => !sinceIds.has(c.id));
    const sofar = before.length ? buildStorySoFar(before, Math.floor(budget * 0.25)) : "";
    if (sofar) parts.push(sofar);
    // Newest chapters matter most if they don't all fit.
    let remaining = Math.floor(budget * 0.5);
    const kept: string[] = [];
    for (let i = numbered.length - 1; i >= 0; i--) {
      const text = `Chapter ${i + 1}: "${numbered[i].title}"\n${numbered[i].body}`;
      const cost = estimateTokens(text);
      if (cost > remaining && kept.length > 0) break;
      kept.unshift(text);
      remaining -= cost;
    }
    parts.push(`Current entry:\n${JSON.stringify(opts.existing)}`);
    parts.push(`Chapters since the entry was last updated:\n\n${kept.join("\n\n")}`);
    task =
      `Update the entry so it reflects what happened in these chapters (keep details that are still true).` +
      (direction ? ` Extra guidance: ${direction}` : "") +
      `\nAdd "changed_in": the number of the chapter where the most recent change to this entry happened, or null if nothing changed.\n` +
      `Reply with JSON: {"name":"","type":"","aliases":[],"content":"","always_include":false,"changed_in":null}`;
  } else {
    const sofar = opts.path.length ? buildStorySoFar(opts.path, Math.floor(budget * 0.5)) : "";
    if (sofar) parts.push(sofar);
    if (opts.codex.length) parts.push(`Existing codex entries (don't duplicate these):\n${describeCodex(opts.codex)}`);
    if (opts.existing) {
      parts.push(`Current entry:\n${JSON.stringify(opts.existing)}`);
      if (!direction) throw new Error("Tell the AI what to change about this entry.");
      task = `Rewrite the entry according to this instruction: ${direction}`;
    } else {
      if (!direction) throw new Error("Describe what you want, for example “a grizzled ferryman who owes the hero a favour”.");
      task = `Create a new codex entry for: ${direction}`;
    }
  }
  if (notes.length) parts.push(notesBlock(notes));
  parts.push(task);
  return { request: { system: SYSTEM_ENTRY, message: parts.join("\n\n") }, numbered };
}

export async function draftEntry(settings: Settings, opts: DraftEntryOptions): Promise<DraftEntryResult> {
  const { request, numbered } = buildEntry(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    signal: opts.signal,
    source: { label: "Codex entry draft", ...opts.source },
  });
  const json = extractJson(reply) as Record<string, unknown>;
  const fields = parseFields(json);
  if (!fields) throw new Error("The AI's entry had no name. Try again.");

  let changedIn: string | null = null;
  if (typeof json.changed_in === "number" && Number.isInteger(json.changed_in)) {
    changedIn = numbered[json.changed_in - 1]?.id ?? null;
  }
  return { fields, changedInChapterId: changedIn };
}
