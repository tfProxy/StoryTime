// AI helper for "Tidy this entry": the AI reads one entry's facts and the shared category list (Settings → Codex) and
// proposes renames, merges and splits so the facts sit under the listed categories, one fact per aspect, without
// adding or changing any detail. The owner ticks the ones to keep on the entry page; they are written as corrections
// (each fact reads that way from where it was set). Runs in the browser; pure apart from `completeChat`.
import { completeChat, type AiSourceIds } from "./client";
import type { PromptParts } from "./prompts";
import { extractJson } from "./codexAi";
import { FACT_LIMITS, cleanForm, isFormAspect, sameAspect, type CodexEntry, type LiveFact } from "../codex";
import { DEFAULT_CATEGORIES, categoryGuide, formFor, resolveAspect, type Category, type CategoryLists } from "../codexCategories";
import type { Settings } from "../settings";

export const MAX_TIDY_CHANGES = 30;

/** One proposed change: the facts it replaces (by id) and the fact they become; `text` "" removes them. */
export type TidyChange = {
  sources: string[];
  aspect: string;
  form: string;
  text: string;
  /** A few words on why, from the AI ("Fur is filed under Skin"). */
  why: string;
  /** The aspect is not on the category list. */
  newCategory: boolean;
};

const asString = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

const SYSTEM_TIDY = `You tidy one entry of a story's codex. The codex records the lasting state of a character, place or thing as small facts, one per aspect, for example "Ears: tall russet fox ears". This entry's facts were written before the author fixed a list of aspects, so some sit under names that aren't on the list, overlap, or mix several details. Propose changes so that every fact is under the listed aspect it fits, with one fact per aspect (per form).

Kinds of change:
- Rename: a fact under an aspect that isn't on the list, or under the wrong one, moves to the listed aspect that fits ("Fur" to "Skin", "Status" to "Condition").
- Merge: two or more facts about the same aspect and form become one that keeps every detail. Where they disagree, keep the one listed later.
- Split: a fact that mixes details of different aspects becomes one fact per aspect. List the same fact number in each part.
- Remove: a fact that only says something is missing ("Tail: none", "Wings: no wings") is removed: give "text" "".
- Every form: a fact given a form under an aspect that is not marked "can differ by form" (personality, relationships, history…) moves to every form ("form" ""), merged with that aspect's every-form fact if there is one.

Rules:
- Never add a detail, never drop one (except a "none" fact), never change what a fact means. Keep the author's wording where you can; facts stay short, in the present tense, using names, not pronouns.
- Keep each fact's form, except as above: "form" is "" for a fact for every form, or the form's name as listed. Only merge facts of the same form.
- Two facts must never end up under the same aspect and form: merge them instead, or file one under another aspect it fits better.
- Use only the aspects listed, spelled as listed. Only when nothing fits, keep the fact's own aspect.
- Leave out facts that are already fine. If nothing needs tidying, reply {"changes":[]}.
- Give each change "from" (the numbers of the facts it replaces), "aspect", "form", "text" and "why" (a few words, such as "Fur is filed under Skin").
Reply with JSON only, in this shape:
{"changes":[{"from":[1,2],"aspect":"","form":"","text":"","why":""}]}`;

/** The facts the tidy reads, in the order they are numbered: every fact with an aspect or text, the form left out. */
export const tidyFacts = (e: CodexEntry): LiveFact[] => e.facts.filter((f) => !isFormAspect(f.aspect) && (f.text.trim() || f.aspect.trim()));

export function tidyRequest(entry: CodexEntry, lists: CategoryLists = DEFAULT_CATEGORIES): PromptParts {
  const list = lists[entry.type];
  const facts = tidyFacts(entry)
    .map((f, i) => `${i + 1}. ${f.aspect.trim() || "(no aspect)"} [${f.form.trim() ? `${f.form.trim()} form` : "every form"}]: ${f.text.trim()}`)
    .join("\n");
  const message = [
    `The entry: ${entry.name} [${entry.type}]${entry.aliases.length ? ` (also: ${entry.aliases.join(", ")})` : ""}`,
    entry.forms.length ? `Its forms: ${entry.forms.join(", ")}` : "",
    list.length ? `The aspects to use for a ${entry.type}:\n${categoryGuide(list)}` : `There is no list of aspects for a ${entry.type}: only merge, split and remove.`,
    `Its facts:\n${facts}`,
    "Propose the changes that tidy these facts, as JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: SYSTEM_TIDY, message };
}

/** Turns a model reply into changes, dropping what can't be trusted (unknown fact numbers, a form the entry lacks, no change). */
export function parseTidy(reply: string, entry: CodexEntry, lists: CategoryLists = DEFAULT_CATEGORIES): TidyChange[] {
  const raw = extractJson(reply);
  const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { changes?: unknown }).changes : null;
  if (!Array.isArray(items)) return [];
  const facts = tidyFacts(entry);
  const list = lists[entry.type];
  const out: TidyChange[] = [];
  for (const item of items) {
    if (out.length >= MAX_TIDY_CHANGES) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const from = Array.isArray(o.from) ? o.from : [o.from];
    const sources: LiveFact[] = [];
    for (const n of from) {
      const f = facts[(typeof n === "number" ? n : Number(n)) - 1];
      if (f && !sources.includes(f)) sources.push(f);
    }
    if (sources.length === 0) continue;
    const text = asString(o.text, FACT_LIMITS.text);
    // Resolved against the list only: the point is to move the entry off its old names.
    const resolved = resolveAspect(asString(o.aspect, FACT_LIMITS.aspect), list);
    const aspect = resolved.aspect || (sources.length === 1 ? sources[0].aspect.trim() : "");
    if (isFormAspect(aspect)) continue;
    let form = formFor(aspect, cleanForm(asString(o.form, FACT_LIMITS.form)), list);
    const knownForm = [...entry.forms, ...sources.map((s) => s.form)].find((f) => f.trim() && sameAspect(f, form));
    if (form && !knownForm) continue;
    form = knownForm?.trim() ?? "";
    // A single fact given back as it is changes nothing.
    if (sources.length === 1 && text && sameAspect(sources[0].aspect, aspect) && sameAspect(sources[0].form, form) && sources[0].text.trim() === text) continue;
    const known = !aspect || list.length === 0 || resolved.known || sources.some((s) => sameAspect(s.aspect, aspect));
    out.push({ sources: sources.map((s) => s.fact_id), aspect, form, text, why: asString(o.why, 120), newCategory: !known });
  }
  return oneFactPerAspect(out, facts, list);
}

/** "Hard, rough ground" + "Dim and dark" → "Hard, rough ground. Dim and dark". */
const joinTexts = (a: string, b: string) => (!a ? b : !b ? a : `${/[.!?…]$/.test(a.trim()) ? a.trim() : `${a.trim()}.`} ${b.trim()}`);
const keyOf = (aspect: string, form: string) => (aspect.trim() ? `${aspect.trim().toLowerCase()}\n${form.trim().toLowerCase()}` : "");

/**
 * Makes sure the result has one fact per aspect and form, whatever the AI proposed: changes that land on the same aspect
 * are merged into one, a fact left alone that a change lands on joins that change, facts left alone that already share
 * an aspect are merged, and a fact left alone under an aspect that is the same in every form loses its form. The texts
 * are joined in order; the owner reads the result before applying it.
 */
export function oneFactPerAspect(changes: TidyChange[], facts: LiveFact[], list: Category[]): TidyChange[] {
  const touched = new Set(changes.flatMap((c) => c.sources));
  const out: TidyChange[] = [];
  const at = new Map<string, TidyChange>();
  const add = (c: TidyChange) => {
    const key = c.text ? keyOf(c.aspect, c.form) : "";
    const there = key ? at.get(key) : undefined;
    if (!there) {
      out.push(c);
      if (key) at.set(key, c);
      return;
    }
    for (const id of c.sources) if (!there.sources.includes(id)) there.sources.push(id);
    there.text = joinTexts(there.text, c.text);
    there.why = [there.why, c.why].filter(Boolean).join("; ");
    there.newCategory = there.newCategory || c.newCategory;
  };
  for (const c of changes) add({ ...c, sources: [...c.sources] });
  // Facts the changes leave alone: each may land on a change's aspect, share one with another, or need its form dropped.
  for (const f of facts) {
    if (touched.has(f.fact_id) || !f.aspect.trim() || !f.text.trim()) continue;
    const form = formFor(f.aspect, f.form, list);
    const there = at.get(keyOf(f.aspect, form));
    if (there) {
      // Onto a change: the fact left alone reads first. Onto another fact left alone: in the order they're listed.
      if (out.includes(there)) {
        there.sources.unshift(f.fact_id);
        there.text = joinTexts(f.text, there.text);
      } else {
        there.sources.push(f.fact_id);
        there.text = joinTexts(there.text, f.text);
      }
      there.why = there.why || `Two facts for ${there.aspect}`;
      continue;
    }
    const moved = form !== f.form;
    const c: TidyChange = { sources: [f.fact_id], aspect: f.aspect.trim(), form, text: f.text.trim(), why: moved ? `${f.aspect.trim()} is the same in every form` : "", newCategory: false };
    if (moved) add(c);
    else at.set(keyOf(c.aspect, c.form), c); // left alone unless another fact joins it (below)
  }
  // A fact left alone that another one joined became a merge; one nothing joined stays as it is.
  for (const c of at.values()) if (!out.includes(c) && c.sources.length > 1) out.push(c);
  return out.map((c) => (c.sources.length > 1 && !c.why ? { ...c, why: `Two facts for ${c.aspect}` } : c));
}

export type TidyOp = { op: "set" | "retire"; fact_id?: string; aspect: string; form: string; text: string; quote: string; anchor: string };

/**
 * The fact changes for the chosen tidy changes, as corrections: a set or retire anchored where the fact's current
 * version was set, so it reads that way from there on. A change keeps the first of its facts not already kept by an
 * earlier change (a split's later parts are new facts there); every other fact it replaces is removed. Removals come
 * first: a fact can't be set to an aspect another live fact of the same form still holds.
 */
export function tidyOps(entry: CodexEntry, changes: TidyChange[]): TidyOp[] {
  const byId = new Map(entry.facts.map((f) => [f.fact_id, f]));
  const kept = new Set<string>();
  const sets: TidyOp[] = [];
  const replaced: string[] = [];
  for (const c of changes) {
    const sources = c.sources.map((id) => byId.get(id)).filter((f): f is LiveFact => !!f);
    if (sources.length === 0) continue;
    for (const s of sources) if (!replaced.includes(s.fact_id)) replaced.push(s.fact_id);
    if (!c.text) continue;
    const keep = sources.find((s) => !kept.has(s.fact_id));
    if (keep) kept.add(keep.fact_id);
    const quote = keep && sources.length === 1 && keep.text.trim() === c.text ? keep.quote : "";
    sets.push({ op: "set", fact_id: keep?.fact_id, aspect: c.aspect, form: c.form, text: c.text, quote, anchor: (keep ?? sources[0]).op.anchor_chapter_id });
  }
  const retires: TidyOp[] = replaced
    .filter((id) => !kept.has(id))
    .map((id) => {
      const f = byId.get(id)!;
      return { op: "retire", fact_id: id, aspect: f.aspect, form: f.form, text: "", quote: "", anchor: f.op.anchor_chapter_id };
    });
  return [...retires, ...sets];
}

export async function runTidy(settings: Settings, entry: CodexEntry, opts: { signal?: AbortSignal; source?: AiSourceIds } = {}): Promise<TidyChange[]> {
  const request = tidyRequest(entry, settings.codexCategories);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: "cheap",
    signal: opts.signal,
    source: { label: `Tidy “${entry.name}”`, ...opts.source },
  });
  return parseTidy(reply, entry, settings.codexCategories);
}
