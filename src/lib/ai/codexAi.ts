// AI helpers for the codex: scan chapters for entries to add/change, and draft or update
// a single entry. All of it runs in the browser with the user's own key; nothing is saved
// until the user accepts and posts.
import { completeChat } from "./client";
import { buildStorySoFar, estimateTokens, notesBlock, parseInstruction, type ContextChapter } from "./prompts";
import { ENTRY_TYPES, foldCodex, type CodexEntry, type CodexOp, type EntryType } from "../codex";
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

export type Proposal = EntryFields & {
  key: string;
  action: "create" | "replace" | "retire";
  /** The existing entry id, or a temporary "new-N" id for an entry this run proposes to create. */
  ref: string;
  /** True if `ref` is temporary (the entry doesn't exist yet). */
  isNew: boolean;
  reason: string;
  anchorChapterId: string;
  anchorTitle: string;
  /** What the entry looks like now, for showing what a replace changes. */
  previous: { name: string; content: string } | null;
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

// ---------- scanning chapters ----------

// What makes a good entry. Shared by both prompts below, because the model can't guess how the
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

const SYSTEM_ANALYZE = `You maintain the codex (a reference list of characters, places, items, factions and lore) for a branching story, so that future writers keep the facts consistent.
You are given the codex as it stands and one chapter. List the changes this chapter establishes:
- "create": a new character, place, item, faction or piece of lore that appears and is likely to recur or to constrain later chapters. Skip trivial one-off background details and anything already covered by an existing entry.
- "replace": an existing entry whose facts changed or were significantly revealed. Give the COMPLETE updated entry, keeping details that are still true.
- "retire": an entry that no longer applies and should stop being shown to writers. Prefer "replace" instead (for example a dead character is still worth remembering, so record that they died).
Rules: use only what the chapter text says. Describe the current state, in present tense. Do not repeat an entry that hasn't changed. At most 8 changes, but fewer, more valuable changes are better than filling the list.

${CODEX_GUIDE}

Reply with JSON only, in this shape:
{"changes":[{"action":"create|replace|retire","entry":"existing entry name (for replace/retire)","name":"","type":"character|place|item|faction|lore|note","aliases":[],"content":"","always_include":false,"reason":"one short sentence"}]}
If nothing needs to change, reply {"changes":[]}.`;

function describeCodex(entries: CodexEntry[]): string {
  if (entries.length === 0) return "(empty)";
  return entries
    .map((e) => `- ${e.name} [${e.type}]${e.aliases.length ? ` (also: ${e.aliases.join(", ")})` : ""}: ${e.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

const norm = (s: string) => s.trim().toLowerCase();

function findEntry(entries: CodexEntry[], name: string): CodexEntry | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return entries.find((e) => norm(e.name) === n || e.aliases.some((a) => norm(a) === n));
}

export type AnalyzeOptions = {
  story: StoryInfo;
  /** Chapters from the root down to the selected chapter. */
  path: PathChapter[];
  /** Existing codex ops on that path. */
  ops: CodexOp[];
  /** "chapter" reads only the last chapter; "path" reads every chapter in order. */
  scope: "chapter" | "path";
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Called after each chapter with all proposals so far. */
  onProposals?: (proposals: Proposal[]) => void;
};

export async function analyzePath(settings: Settings, opts: AnalyzeOptions): Promise<Proposal[]> {
  const { story, path, ops, scope } = opts;
  const targets = scope === "chapter" ? path.slice(-1) : path;
  const budget = Math.max(1000, settings.contextTokens - 1500);
  const virtualOps: CodexOp[] = [];
  const proposals: Proposal[] = [];
  let counter = 0;

  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    opts.onProgress?.(i, targets.length);
    const ch = targets[i];

    // The codex as it stood when this chapter began, plus what this run has proposed so far.
    const state = foldCodex([...ops.filter((o) => o.anchor_depth <= ch.depth), ...virtualOps]);
    const earlier = path.filter((c) => c.depth < ch.depth);
    const soFar = earlier.length ? buildStorySoFar(earlier, Math.floor(budget * 0.35)) : "";
    const body = ch.body.length > budget * 2 ? `${ch.body.slice(0, budget * 2)}…` : ch.body;

    const prompt = [
      `Story: ${story.title}${story.premise.trim() ? `\nPremise: ${story.premise.trim()}` : ""}`,
      soFar && `${soFar}`,
      `Codex so far:\n${describeCodex(state)}`,
      `Chapter to read: "${ch.title}"\n${body}`,
      "List the codex changes this chapter establishes, as JSON.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const reply = await completeChat(settings, {
      system: SYSTEM_ANALYZE,
      messages: [{ role: "user", content: prompt }],
      // A whole-path scan makes one call per chapter, so use the cheaper model for it.
      useSummaryModel: scope === "path",
      signal: opts.signal,
    });

    const json = extractJson(reply) as { changes?: unknown };
    const changes = Array.isArray(json.changes) ? json.changes : [];
    for (const raw of changes.slice(0, 8)) {
      const p = toProposal(raw, state, ch, () => `new-${++counter}`, `${i}-${proposals.length}`);
      if (!p) continue;
      proposals.push(p);
      virtualOps.push(toVirtualOp(p, ch, virtualOps.length));
    }
    opts.onProposals?.([...proposals]);
  }
  opts.onProgress?.(targets.length, targets.length);
  return proposals;
}

function toProposal(
  raw: unknown,
  state: CodexEntry[],
  ch: PathChapter,
  newRef: () => string,
  key: string,
): Proposal | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = o.action === "replace" || o.action === "retire" || o.action === "create" ? o.action : null;
  if (!action) return null;
  const reason = asString(o.reason, 300);
  const anchor = { anchorChapterId: ch.id, anchorTitle: ch.title };

  if (action === "retire") {
    const target = findEntry(state, asString(o.entry, 100) || asString(o.name, 100));
    if (!target) return null;
    return {
      key, action, ref: target.entry_id, isNew: target.entry_id.startsWith("new-"), reason, ...anchor,
      name: target.name, type: target.type, aliases: target.aliases, content: target.content,
      always_include: target.always_include, previous: { name: target.name, content: target.content },
    };
  }

  const fields = parseFields(o);
  if (!fields) return null;
  // A "create" of something that already exists is really a change to it; a "replace" of something
  // we can't find is really a create.
  const existing =
    findEntry(state, asString(o.entry, 100)) ?? findEntry(state, fields.name) ?? undefined;
  if (existing) {
    const same =
      existing.name === fields.name &&
      existing.type === fields.type &&
      existing.content === fields.content &&
      existing.aliases.join("|") === fields.aliases.join("|") &&
      existing.always_include === fields.always_include;
    if (same) return null;
    return {
      key, action: "replace", ref: existing.entry_id, isNew: existing.entry_id.startsWith("new-"), reason, ...anchor,
      ...fields, previous: { name: existing.name, content: existing.content },
    };
  }
  return { key, action: "create", ref: newRef(), isNew: true, reason, ...anchor, ...fields, previous: null };
}

function toVirtualOp(p: Proposal, ch: PathChapter, n: number): CodexOp {
  return {
    id: `virtual-${n}`,
    anchor_chapter_id: ch.id,
    anchor_depth: ch.depth,
    entry_id: p.ref,
    op: p.action,
    name: p.name,
    type: p.type,
    aliases: p.aliases,
    content: p.content,
    always_include: p.always_include,
    posted_at: Date.now() + n,
  };
}

/**
 * Posts accepted proposals in order. `send` posts one op and returns the entry id the server
 * used. Proposals that touch an entry this run was going to create (but the user rejected)
 * become creates themselves, or are skipped if they were retirements.
 */
export async function applyProposals(
  accepted: Proposal[],
  send: (body: Record<string, unknown>) => Promise<string>,
): Promise<number> {
  const real = new Map<string, string>(); // temporary ref -> real entry id
  let posted = 0;
  for (const p of accepted) {
    const fields = { name: p.name, type: p.type, aliases: p.aliases, content: p.content, always_include: p.always_include };
    const base = { anchor_chapter_id: p.anchorChapterId };
    if (p.action === "create") {
      real.set(p.ref, await send({ ...base, op: "create", ...fields }));
    } else {
      const id = p.isNew ? real.get(p.ref) : p.ref;
      if (!id) {
        if (p.action === "retire") continue;
        real.set(p.ref, await send({ ...base, op: "create", ...fields }));
      } else if (p.action === "retire") {
        await send({ ...base, op: "retire", entry_id: id });
      } else {
        await send({ ...base, op: "replace", entry_id: id, ...fields });
      }
    }
    posted++;
  }
  return posted;
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
};

export type DraftEntryResult = { fields: EntryFields; changedInChapterId: string | null };

export async function draftEntry(settings: Settings, opts: DraftEntryOptions): Promise<DraftEntryResult> {
  const budget = Math.max(1000, settings.contextTokens - 1500);
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

  const reply = await completeChat(settings, {
    system: SYSTEM_ENTRY,
    messages: [{ role: "user", content: parts.join("\n\n") }],
    signal: opts.signal,
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
