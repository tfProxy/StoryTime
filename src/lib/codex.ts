// The codex is an append-only log of ops, each anchored at a chapter. An op applies to its
// anchor chapter and every descendant of it. The codex "at" a chapter is the fold of the ops
// anchored on the path from the story root to that chapter. Pure code: used by server and browser.

export const ENTRY_TYPES = ["character", "place", "item", "faction", "lore", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export type CodexOp = {
  id: string;
  anchor_chapter_id: string;
  /** Depth of the anchor chapter; deeper anchors override shallower ones. */
  anchor_depth: number;
  entry_id: string;
  op: "create" | "replace" | "retire";
  name: string;
  type: EntryType;
  aliases: string[];
  content: string;
  always_include: boolean;
  posted_at: number;
  /** Set on the op that links a shared entry into the story (see `resolveShared`); the entry reads from that base. */
  shared_entry_id?: string | null;
  /** On a linked entry's ops: what this story changes from the base from here on (merged along the path). */
  overrides?: Overrides | null;
  /** On a linked entry's resolved ops: the fields this story has changed from the base. */
  overridden?: string[];
};

/**
 * What one story changes in a linked (shared) entry. The name always comes from the base. Keywords are a set:
 * the story adds some and hides some of the base's.
 */
export type Overrides = {
  type?: EntryType;
  content?: string;
  always_include?: boolean;
  aliases_add?: string[];
  aliases_remove?: string[];
  /** Fields to take back from the base: cleared before this op's own changes are applied ("aliases" clears both keyword lists). */
  reset?: OverrideField[];
};

export const OVERRIDE_FIELDS = ["type", "content", "always_include", "aliases"] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** A shared entry as the codex fold needs it: its fields and its facts. It belongs to no story and has no chapter. */
export type SharedBase = {
  id: string;
  name: string;
  type: EntryType;
  aliases: string[];
  content: string;
  always_include: boolean;
  facts: { id: string; aspect: string; form: string; text: string }[];
};

/**
 * One change to one fact of an entry: "Ears: tall russet fox ears", anchored at the chapter where it became true.
 * Facts sharing a `fact_id` are versions of one fact; the last one on the path wins, as with entry ops.
 */
export type FactOp = {
  id: string;
  anchor_chapter_id: string;
  anchor_depth: number;
  entry_id: string;
  fact_id: string;
  op: "set" | "retire";
  /** What the fact describes ("Ears"); "" for a loose fact; FORM_ASPECT for the entry's current form. */
  aspect: string;
  /** The form the fact belongs to ("" = every form). On the FORM_ASPECT fact: the form the entry is in now. */
  form: string;
  text: string;
  /** The sentence from the chapter that shows it; "" when there is none. */
  quote: string;
  posted_at: number;
};

/** The aspect of the fact that says which form an entry is in now. One per entry. */
export const FORM_ASPECT = "form";

export const FACT_LIMITS = { aspect: 40, form: 40, text: 1000, quote: 500 };

/** Aspects offered when adding a fact, by entry type. Any other name may be typed. */
export const STARTER_ASPECTS: Record<EntryType, string[]> = {
  character: ["Sex", "Species", "Build", "Height", "Skin", "Fur", "Hair", "Ears", "Eyes", "Tail", "Hands", "Voice", "Clothing", "Personality", "Status", "Relationships"],
  place: ["Location", "Appearance", "Controlled by", "Rules", "Status"],
  item: ["Appearance", "Properties", "Held by", "Condition"],
  faction: ["Leader", "Members", "Goals", "Allies", "Enemies"],
  lore: ["Rules", "History"],
  note: [],
};

export const isFormAspect = (aspect: string) => aspect.trim().toLowerCase() === FORM_ASPECT;
export const sameAspect = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A fact as it stands at a chapter. */
export type LiveFact = {
  fact_id: string;
  aspect: string;
  form: string;
  text: string;
  quote: string;
  /** The op that set this version. */
  op: FactOp;
};

export type CodexEntry = {
  entry_id: string;
  name: string;
  type: EntryType;
  aliases: string[];
  /** The entry's own free text ("Notes"). What the AI reads is `description`. */
  content: string;
  always_include: boolean;
  /** The last op that changed the entry, carrying the entry's folded fields. */
  op: CodexOp;
  /** The shared entry this one is linked to; null for an entry of the story's own. */
  shared_entry_id: string | null;
  /** On a linked entry: the fields this story has changed from the shared base ("type", "content", "always_include", "aliases"). */
  overridden: string[];
  /** Each keyword and the chapter whose change added it (for showing inherited keywords). */
  keywordSources: KeywordSource[];
  /** Every live fact, in the order they were first set; facts of other forms included. */
  facts: LiveFact[];
  /** The form the entry is in now, from its FORM_ASPECT fact; null when it has none. */
  form: { name: string; note: string; fact: LiveFact } | null;
  /** Every form named by its facts (and the current one). */
  forms: string[];
  /** The entry's normal form: the first one it was given (null when it never had one). The AI isn't told the entry is in it. */
  baseForm: string | null;
  /** What the AI reads: the current form and the facts that apply to it (never the notes). */
  description: string;
};

type Ordered = { anchor_depth: number; posted_at: number };

/** Ops in the order they take effect: by anchor depth, then post time, then given order. */
export function orderOps<T extends Ordered>(ops: T[]): T[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.anchor_depth - b.op.anchor_depth || a.op.posted_at - b.op.posted_at || a.i - b.i)
    .map((x) => x.op);
}

/** The live facts of each entry, by entry id, each list in the order its facts were first set. */
export function foldFacts(facts: FactOp[]): Map<string, LiveFact[]> {
  const live = new Map<string, Map<string, LiveFact>>();
  for (const f of orderOps(facts)) {
    let byId = live.get(f.entry_id);
    if (!byId) live.set(f.entry_id, (byId = new Map()));
    if (f.op === "retire") byId.delete(f.fact_id);
    else if (byId.has(f.fact_id)) byId.set(f.fact_id, { ...byId.get(f.fact_id)!, aspect: f.aspect, form: f.form, text: f.text, quote: f.quote, op: f });
    else byId.set(f.fact_id, { fact_id: f.fact_id, aspect: f.aspect, form: f.form, text: f.text, quote: f.quote, op: f });
  }
  return new Map([...live].map(([id, m]) => [id, [...m.values()]]));
}

/** Every version of one fact along the path, oldest first (retirements included). */
export function factHistory(facts: FactOp[], factId: string): FactOp[] {
  return orderOps(facts).filter((f) => f.fact_id === factId);
}

/** The facts that describe the entry now: every-form facts plus those of the current form (not the form fact itself). */
export function applicableFacts(facts: LiveFact[], form: string | null): LiveFact[] {
  return facts.filter((f) => !isFormAspect(f.aspect) && (f.form === "" || (form !== null && sameAspect(f.form, form))));
}

/**
 * Each entry's base form, by entry id: the first form it was given (its earliest form fact that names a form). It is the
 * entry's normal form: the AI isn't told it is in it, and an entry whose form was taken away reads as in it.
 */
export function baseForms(facts: FactOp[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of orderOps(facts)) {
    if (f.op === "set" && isFormAspect(f.aspect) && f.form.trim() && !out.has(f.entry_id)) out.set(f.entry_id, f.form.trim());
  }
  return out;
}

/**
 * What the AI reads for an entry: "Form: vixen, change complete. Ears: tall fox ears. ..." The notes are left out.
 * A fact anchored at `recentAnchor` (the chapter just before the one being written, or the chapter being
 * edited) or held in the draft is marked as just changed, so the writer shows the character noticing it.
 * While the entry is in its `baseForm` (its normal form) the "Form:" line is left out, unless it has a stage note or
 * it just changed back; the facts of that form still apply, also when no form is set at all.
 */
export function describeEntry(facts: LiveFact[], recentAnchor?: string, baseForm?: string | null): string {
  const recent = (f: LiveFact) => !!recentAnchor && (f.op.anchor_chapter_id === recentAnchor || f.op.anchor_chapter_id === DRAFT_ANCHOR);
  // "Ears: fox ears (just changed)." — the mark goes inside the sentence's full stop.
  const sentence = (s: string, f: LiveFact) => {
    const t = s.trim().replace(/\s+/g, " ");
    const m = recent(f) ? " (just changed)" : "";
    if (/[.!?…]$/.test(t)) return `${t.slice(0, -1)}${m}${t.slice(-1)}`;
    return /["”)]$/.test(t) && !m ? t : `${t}${m}.`;
  };
  const formFact = facts.find((f) => isFormAspect(f.aspect));
  const parts: string[] = [];
  if (formFact) {
    const label = [formFact.form, formFact.text].map((s) => s.trim()).filter(Boolean).join(", ");
    const normal = !!baseForm && sameAspect(formFact.form, baseForm) && !formFact.text.trim() && !recent(formFact);
    if (label && !normal) parts.push(sentence(`Form: ${label}`, formFact));
  }
  for (const f of applicableFacts(facts, formFact ? formFact.form : (baseForm ?? null))) {
    if (!f.text.trim()) continue;
    parts.push(sentence(f.aspect.trim() ? `${f.aspect.trim()}: ${f.text.trim()}` : f.text, f));
  }
  return parts.join(" ");
}

/** The sentence the AI reads for a form and its stage: "Form: vixen, halfway." (as `describeEntry` writes it). */
export function formLine(form: string, stage: string): string {
  const label = [form, stage].map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean).join(", ");
  if (!label) return "";
  return /[.!?…]$/.test(label) || /["”)]$/.test(label) ? `Form: ${label}` : `Form: ${label}.`;
}

/** Every aspect named by a fact of these entries (the form aspect left out), once each, for suggestions when adding a fact. */
export function usedAspectsOf(entries: CodexEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    for (const f of e.facts) {
      if (f.aspect.trim() && !isFormAspect(f.aspect) && !out.some((a) => sameAspect(a, f.aspect))) out.push(f.aspect.trim());
    }
  }
  return out;
}

function withFacts(op: CodexOp, facts: LiveFact[], recentAnchor?: string, keywordSources?: KeywordSource[], baseForm: string | null = null): CodexEntry {
  const formFact = facts.find((f) => isFormAspect(f.aspect)) ?? null;
  const forms: string[] = [];
  for (const name of [formFact?.form ?? "", ...facts.filter((f) => !isFormAspect(f.aspect)).map((f) => f.form)]) {
    if (name.trim() && !forms.some((n) => sameAspect(n, name))) forms.push(name.trim());
  }
  return {
    keywordSources: keywordSources ?? op.aliases.map((alias) => ({ alias, chapter_id: op.anchor_chapter_id })),
    entry_id: op.entry_id,
    name: op.name,
    type: op.type,
    aliases: op.aliases,
    content: op.content,
    always_include: op.always_include,
    op,
    shared_entry_id: op.shared_entry_id ?? null,
    overridden: op.overridden ?? [],
    facts,
    form: formFact ? { name: formFact.form, note: formFact.text, fact: formFact } : null,
    forms,
    baseForm,
    description: describeEntry(facts, recentAnchor, baseForm),
  };
}

export type FoldOptions = {
  /** Facts anchored here are marked "(just changed)" in `description`. */
  recentAnchor?: string;
};

/**
 * The live entries produced by a set of ops (already limited to one root->chapter path), with the facts
 * on the same path folded into each.
 */
export function foldCodex(ops: CodexOp[], facts: FactOp[] = [], options: FoldOptions = {}): CodexEntry[] {
  const liveFacts = facts.length ? foldFacts(facts) : new Map<string, LiveFact[]>();
  const bases = facts.length ? baseForms(facts) : new Map<string, string>();
  return [...foldEntries(ops).values()]
    .filter((s) => s.alive)
    .map((s) => withFacts(s.op, liveFacts.get(s.op.entry_id) ?? [], options.recentAnchor, s.sources, bases.get(s.op.entry_id) ?? null))
    .sort((a, b) => ENTRY_TYPES.indexOf(a.type) - ENTRY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
}

/** Entries that were retired on this path, as they last looked before retirement. */
export function retiredEntries(ops: CodexOp[]): CodexEntry[] {
  return [...foldEntries(ops).values()].filter((s) => !s.alive).map((s) => withFacts(s.op, [], undefined, s.sources));
}

/** Where a keyword came from: the chapter whose change added it. */
export type KeywordSource = { alias: string; chapter_id: string };

// ---- Folding entry ops field by field ----
//
// An op stores a whole copy of the entry, but it only *changes* the fields that differ from the entry as it
// stood when the op was posted (on the same path). So a later edit at an earlier chapter (a keyword added at
// the first chapter) still reaches a chapter below that changed something else (its notes). Keywords are a
// set: an op adds and removes single keywords. A create, or an op with nothing before it, sets everything.

type Fields = Pick<CodexOp, "name" | "type" | "aliases" | "content" | "always_include">;
type Delta = { full: true; fields: Fields } | { full: false; patch: Partial<Omit<Fields, "aliases">>; add: string[]; remove: string[] };
type Folded = { alive: boolean; fields: Fields; op: CodexOp; sources: KeywordSource[] };

const lc = (s: string) => s.trim().toLowerCase();
const fieldsOf = (op: CodexOp): Fields => ({ name: op.name, type: op.type, aliases: op.aliases, content: op.content, always_include: op.always_include });

function deltaOf(op: CodexOp, before: Fields | null): Delta {
  if (op.op === "create" || before === null) return { full: true, fields: fieldsOf(op) };
  const patch: Partial<Omit<Fields, "aliases">> = {};
  if (op.name !== before.name) patch.name = op.name;
  if (op.type !== before.type) patch.type = op.type;
  if (op.content !== before.content) patch.content = op.content;
  if (op.always_include !== before.always_include) patch.always_include = op.always_include;
  const had = new Set(before.aliases.map(lc));
  const has = new Set(op.aliases.map(lc));
  return { full: false, patch, add: op.aliases.filter((a) => !had.has(lc(a))), remove: before.aliases.filter((a) => !has.has(lc(a))) };
}

/** Applies one entry's ops (in effect order) with their deltas. With `ignoreRetire`, the last known version even if retired. */
function applyDeltas(ops: CodexOp[], deltas: Map<CodexOp, Delta>, ignoreRetire: boolean): Folded | null {
  let cur = null as Folded | null;
  for (const op of ops) {
    if (op.op === "retire") {
      if (cur && !ignoreRetire) cur = { ...cur, alive: false, op: { ...op, ...cur.fields } };
      continue;
    }
    const d = deltas.get(op);
    if (!d) continue;
    if (d.full || cur === null) {
      const fields = d.full ? d.fields : fieldsOf(op);
      cur = { alive: true, fields, op, sources: fields.aliases.map((alias) => ({ alias, chapter_id: op.anchor_chapter_id })) };
    } else {
      const gone = new Set(d.remove.map(lc));
      const aliases = cur.fields.aliases.filter((a) => !gone.has(lc(a)));
      const sources = cur.sources.filter((s) => !gone.has(lc(s.alias)));
      for (const a of d.add) {
        if (aliases.some((x) => lc(x) === lc(a))) continue;
        aliases.push(a);
        sources.push({ alias: a, chapter_id: op.anchor_chapter_id });
      }
      cur = { alive: true, fields: { ...cur.fields, ...d.patch, aliases }, op, sources };
    }
  }
  // The entry reads as its fields, whatever the last op itself stored.
  return cur && { ...cur, op: { ...cur.op, ...cur.fields } };
}

/** Each entry on the path, folded field by field: alive or retired, its fields, and the last op that changed it. */
function foldEntries(ops: CodexOp[]): Map<string, Folded> {
  const byEntry = new Map<string, CodexOp[]>();
  for (const op of orderOps(ops)) {
    const list = byEntry.get(op.entry_id);
    if (list) list.push(op);
    else byEntry.set(op.entry_id, [op]);
  }
  const out = new Map<string, Folded>();
  for (const [id, list] of byEntry) {
    // Work out each op's change in the order they were posted (a draft's last: it was made from everything else).
    const isDraft = (o: CodexOp) => o.anchor_chapter_id === DRAFT_ANCHOR;
    const posted = [...list].sort((a, b) => Number(isDraft(a)) - Number(isDraft(b)) || a.posted_at - b.posted_at);
    const deltas = new Map<CodexOp, Delta>();
    for (const op of posted) {
      if (op.op === "retire") continue;
      // Compared with the entry's last known version from the ops posted before it (retirements ignored, so a
      // revival only changes what differs from the entry before it was retired).
      // Only what was visible at the op's own chapter: its own and earlier chapters, not those below it.
      const before = applyDeltas(list.filter((o) => deltas.has(o) && o.anchor_depth <= op.anchor_depth), deltas, true);
      deltas.set(op, deltaOf(op, before ? before.fields : null));
    }
    const folded = applyDeltas(list, deltas, false);
    if (folded) out.set(id, folded);
  }
  return out;
}

// ---- Shared entries ----
//
// A shared entry is a base that stories link to. Linking is a "create" op (with `shared_entry_id`) at the chapter
// the entry first appears; from there it reads from the base, live, so editing the base changes every story.
// A story changes a field with `overrides` on its own ops, and a fact with its own fact ops on the base fact's id.
// Both are resolved before the fold (here, once, on the server), so `foldCodex` and everything built on it see
// ordinary ops and facts, in the browser too.

const sameWord = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `later` laid over `earlier`: scalar fields from the later one, keyword changes added up. */
export function mergeOverrides(earlier: Overrides, later: Overrides | null | undefined): Overrides {
  if (!later) return earlier;
  const out: Overrides = { ...earlier };
  delete out.reset; // a reset only matters to what came before it
  const reset = new Set(later.reset ?? []);
  for (const f of reset) {
    if (f === "aliases") {
      delete out.aliases_add;
      delete out.aliases_remove;
    } else delete out[f];
  }
  if (later.type !== undefined) out.type = later.type;
  if (later.content !== undefined) out.content = later.content;
  if (later.always_include !== undefined) out.always_include = later.always_include;
  const kept = (list: string[] | undefined) => (reset.has("aliases") ? [] : (list ?? []));
  const add = [...kept(earlier.aliases_add), ...(later.aliases_add ?? [])].filter((a) => !(later.aliases_remove ?? []).some((r) => sameWord(r, a)));
  const remove = [...kept(earlier.aliases_remove), ...(later.aliases_remove ?? [])].filter((a) => !(later.aliases_add ?? []).some((r) => sameWord(r, a)));
  if (add.length) out.aliases_add = add;
  else delete out.aliases_add;
  if (remove.length) out.aliases_remove = remove;
  else delete out.aliases_remove;
  return out;
}

/** The entry's fields in a story: the base, with the story's overrides laid over it. The name is always the base's. */
export function sharedFields(base: SharedBase, overrides: Overrides): Pick<CodexOp, "name" | "type" | "aliases" | "content" | "always_include"> {
  const gone = overrides.aliases_remove ?? [];
  const aliases = base.aliases.filter((a) => !gone.some((g) => sameWord(g, a)));
  for (const a of overrides.aliases_add ?? []) if (!aliases.some((x) => sameWord(x, a))) aliases.push(a);
  return {
    name: base.name,
    type: overrides.type ?? base.type,
    aliases,
    content: overrides.content ?? base.content,
    always_include: overrides.always_include ?? base.always_include,
  };
}

/** The fields a story has changed in a linked entry, for showing "changed in this story". */
export function overriddenFields(o: Overrides): string[] {
  return [
    ...(o.type !== undefined ? ["type"] : []),
    ...(o.content !== undefined ? ["content"] : []),
    ...(o.always_include !== undefined ? ["always_include"] : []),
    ...(o.aliases_add?.length || o.aliases_remove?.length ? ["aliases"] : []),
  ];
}

/** Which entries on these ops are linked to a shared entry whose base we have: entry id -> base. */
function linkedEntries(ops: CodexOp[], bases: ReadonlyMap<string, SharedBase>): Map<string, SharedBase> {
  const out = new Map<string, SharedBase>();
  for (const op of ops) {
    const base = op.shared_entry_id ? bases.get(op.shared_entry_id) : undefined;
    if (base) out.set(op.entry_id, base);
  }
  return out;
}

/**
 * Gives the ops of linked entries the fields they read now: the shared base with the story's overrides laid over it,
 * accumulated along the path (a create starts them afresh). Ops of other entries, and of linked entries whose base
 * is gone, are returned unchanged. The result is in the order given.
 */
export function resolveShared(ops: CodexOp[], bases: ReadonlyMap<string, SharedBase>): CodexOp[] {
  const linked = linkedEntries(ops, bases);
  if (linked.size === 0) return ops;
  const resolved = new Map<CodexOp, CodexOp>();
  const patches = new Map<string, Overrides>();
  for (const op of orderOps(ops.filter((o) => linked.has(o.entry_id)))) {
    const base = linked.get(op.entry_id)!;
    let patch = patches.get(op.entry_id) ?? {};
    if (op.op === "create") patch = mergeOverrides({}, op.overrides);
    else if (op.op === "replace") patch = mergeOverrides(patch, op.overrides);
    patches.set(op.entry_id, patch);
    resolved.set(op, { ...op, ...sharedFields(base, patch), shared_entry_id: base.id, overridden: overriddenFields(patch) });
  }
  return ops.map((o) => resolved.get(o) ?? o);
}

/**
 * The overrides an op should store so that a linked entry reads `want` in its story: a field that differs from the
 * base is set, one that matches it is taken back from the base. Only the fields in `want` are touched.
 */
export function overridesFor(base: SharedBase, want: Partial<Pick<SharedBase, "type" | "content" | "always_include" | "aliases">>): Overrides {
  const out: Overrides = {};
  const reset: OverrideField[] = [];
  if (want.type !== undefined) {
    if (want.type === base.type) reset.push("type");
    else out.type = want.type;
  }
  if (want.content !== undefined) {
    if (want.content === base.content) reset.push("content");
    else out.content = want.content;
  }
  if (want.always_include !== undefined) {
    if (want.always_include === base.always_include) reset.push("always_include");
    else out.always_include = want.always_include;
  }
  if (want.aliases !== undefined) {
    reset.push("aliases");
    const add = want.aliases.filter((a) => !base.aliases.some((b) => sameWord(a, b)));
    const remove = base.aliases.filter((b) => !want.aliases!.some((a) => sameWord(a, b)));
    if (add.length) out.aliases_add = add;
    if (remove.length) out.aliases_remove = remove;
  }
  if (reset.length) out.reset = reset;
  return out;
}

/** What the AI reads for a shared entry on its own (the same text as `describeEntry` gives for an entry in a story). */
export function describeSharedFacts(facts: SharedBase["facts"]): string {
  const live: LiveFact[] = facts.map((f) => ({
    fact_id: f.id,
    aspect: f.aspect,
    form: f.form,
    text: f.text,
    quote: "",
    op: { id: f.id, anchor_chapter_id: "", anchor_depth: 0, entry_id: "", fact_id: f.id, op: "set", aspect: f.aspect, form: f.form, text: f.text, quote: "", posted_at: 0 },
  }));
  // The shared entry's form is the one it was given, so it is its normal form.
  return describeEntry(live, undefined, facts.find((f) => isFormAspect(f.aspect))?.form.trim() || null);
}

/** Where a fact of a linked entry stands in its story: the shared base's as it is, changed or hidden by the story, or the story's own. */
export function factSharedState(history: FactOp[]): "base" | "changed" | "own" {
  if (!history.some((f) => f.id.startsWith("shared-"))) return "own";
  return history[history.length - 1].id.startsWith("shared-") ? "base" : "changed";
}

/**
 * The base's facts as fact ops for each linked entry, set at the chapter where the entry was linked: the story's own
 * fact ops on the same fact id then change or hide them for that story alone. Put these before the story's facts.
 */
export function sharedFactOps(ops: CodexOp[], bases: ReadonlyMap<string, SharedBase>): FactOp[] {
  const seen = new Set<string>();
  const out: FactOp[] = [];
  for (const op of orderOps(ops)) {
    const base = op.shared_entry_id ? bases.get(op.shared_entry_id) : undefined;
    if (!base || seen.has(op.entry_id)) continue;
    seen.add(op.entry_id);
    for (const f of base.facts) {
      out.push({
        id: `shared-${f.id}-${op.id}`,
        anchor_chapter_id: op.anchor_chapter_id,
        anchor_depth: op.anchor_depth,
        entry_id: op.entry_id,
        fact_id: f.id,
        op: "set",
        aspect: f.aspect,
        form: f.form,
        text: f.text,
        quote: "",
        posted_at: op.posted_at,
      });
    }
  }
  return out;
}

/** All versions of one entry along the path, oldest first (retirements included). */
export function entryHistory(ops: CodexOp[], entryId: string): CodexOp[] {
  return orderOps(ops).filter((o) => o.entry_id === entryId);
}

export type StoryEntrySummary = {
  entry_id: string;
  name: string;
  type: EntryType;
  /** The chapter the entry was created at (the shallowest, if several branches created it). */
  first_chapter_id: string;
  first_chapter_title: string;
  /** The chapter where the entry was last written (its latest op that isn't a retirement), where its page opens. */
  last_chapter_id: string;
  /** True when the op that takes effect last is a retirement. */
  retired: boolean;
};

/** One row per entry across every branch of a story, sorted by name. `ops` must carry `anchor_depth`. */
export function storyEntrySummaries(ops: CodexOp[], chapterTitles: Map<string, string> | Record<string, string>): StoryEntrySummary[] {
  const titleOf = (id: string) => (chapterTitles instanceof Map ? chapterTitles.get(id) : chapterTitles[id]) ?? "";
  const byEntry = new Map<string, CodexOp[]>();
  for (const op of orderOps(ops)) {
    if (isDraftEntry(op.entry_id)) continue;
    const list = byEntry.get(op.entry_id);
    if (list) list.push(op);
    else byEntry.set(op.entry_id, [op]);
  }
  const rows: StoryEntrySummary[] = [];
  for (const [entry_id, list] of byEntry) {
    const last = list[list.length - 1];
    // Name and type come from the last op that carries them (a retire may leave them blank).
    const named = [...list].reverse().find((o) => o.op !== "retire") ?? last;
    const first = list.find((o) => o.op === "create") ?? list[0]; // list is shallowest first
    rows.push({
      entry_id,
      name: named.name,
      type: named.type,
      first_chapter_id: first.anchor_chapter_id,
      first_chapter_title: titleOf(first.anchor_chapter_id),
      last_chapter_id: named.anchor_chapter_id,
      retired: last.op === "retire",
    });
  }
  return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.entry_id.localeCompare(b.entry_id));
}

/** One entry's type, as a word for a single entry ("Character"). */
export const TYPE_LABELS: Record<EntryType, string> = {
  character: "Character",
  place: "Place",
  item: "Item",
  faction: "Faction",
  lore: "Lore",
  note: "Note",
};

export const TYPE_HEADINGS: Record<EntryType, string> = {
  character: "Characters",
  place: "Places",
  item: "Items",
  faction: "Factions",
  lore: "Lore",
  note: "Notes",
};

/** A readable "story bible": the codex on one branch as of one chapter, grouped by type. */
export function toCodexMarkdown(storyTitle: string, chapterTitle: string, entries: CodexEntry[]): string {
  const out = [`# ${storyTitle}: codex`, `*As of the chapter “${chapterTitle}”, on this branch of the story.*`];
  if (entries.length === 0) out.push("*There are no entries yet.*");
  for (const type of ENTRY_TYPES) {
    const group = entries.filter((e) => e.type === type);
    if (group.length === 0) continue;
    out.push(`## ${TYPE_HEADINGS[type]}`);
    for (const e of group) {
      out.push(`### ${e.name}`);
      const notes: string[] = [];
      if (e.aliases.length) notes.push(`Also known as: ${e.aliases.join(", ")}`);
      if (e.always_include) notes.push("Always included in AI prompts");
      if (notes.length) out.push(`*${notes.join(" · ")}*`);
      // The facts are what the AI reads; the notes are the author's own, so they are labelled apart.
      if (e.description.trim()) out.push(e.description.trim());
      if (e.content.trim()) out.push(`**Notes** (not sent to the AI)\n\n${e.content.trim()}`);
      else if (!e.description.trim()) out.push("*(no description)*");
    }
  }
  return `${out.join("\n\n")}\n`;
}

// ---- Changes held in a draft until its chapter is posted ----

/** Stands in for the chapter being written, which has no id until it is posted. */
export const DRAFT_ANCHOR = "draft";

/**
 * A codex change waiting in a draft. New entries get a local id (`draft-…`) until posted. A "create" may add a shared
 * entry (`shared_entry_id`), carrying a copy of it (`shared`, with its facts) so the draft can show it before it is saved.
 */
export type CodexChange = Pick<CodexOp, "op" | "entry_id" | "name" | "type" | "aliases" | "content" | "always_include"> & {
  shared_entry_id?: string;
  shared?: SharedBase;
};

export const isDraftEntry = (entryId: string) => entryId.startsWith("draft-");

/**
 * Adds a change to a draft's list, keeping at most one per entry: a later change to the same entry
 * replaces the earlier one, an entry created in the draft stays a "create", and retiring an entry
 * that only exists in the draft drops it.
 */
export function addChange(changes: CodexChange[], next: CodexChange): CodexChange[] {
  const prev = changes.find((c) => c.entry_id === next.entry_id);
  const rest = changes.filter((c) => c.entry_id !== next.entry_id);
  if (prev?.op === "create") return next.op === "retire" ? rest : [...rest, { ...next, op: "create", shared_entry_id: prev.shared_entry_id, shared: prev.shared }];
  return [...rest, next];
}

/** The draft's changes as ops at `depth` (one below the last chapter of the path), so they win. */
export function draftOps(changes: CodexChange[], depth: number): CodexOp[] {
  return changes.map((c) => ({
    ...c,
    id: `draft-op-${c.entry_id}`,
    anchor_chapter_id: DRAFT_ANCHOR,
    anchor_depth: depth,
    posted_at: 0, // not posted; the depth alone puts these last
  }));
}

/** A fact change waiting in a draft. New facts get a local id (`draft-fact-…`) until posted. */
export type FactChange = Pick<FactOp, "op" | "entry_id" | "fact_id" | "aspect" | "form" | "text" | "quote">;

export const isDraftFact = (factId: string) => factId.startsWith("draft-fact-");

/** Adds a fact change to a draft's list, one per fact; retiring a fact that only exists in the draft drops it. */
export function addFactChange(changes: FactChange[], next: FactChange): FactChange[] {
  const rest = changes.filter((c) => c.fact_id !== next.fact_id);
  return next.op === "retire" && isDraftFact(next.fact_id) ? rest : [...rest, next];
}

/**
 * The codex as the chapter being written will have it: the posted ops and facts (already resolved against the shared
 * entries by the server) with the draft's changes on top, shared entries the draft adds included.
 */
export function foldWithDraft(
  ops: CodexOp[],
  facts: FactOp[],
  changes: CodexChange[],
  factChanges: FactChange[],
  depth: number,
  options?: FoldOptions,
): CodexEntry[] {
  const all = applyDraft(ops, facts, changes, factChanges, depth);
  return foldCodex(all.ops, all.facts, options);
}

/** The posted ops and facts with the draft's changes added (see `foldWithDraft`). */
export function applyDraft(ops: CodexOp[], facts: FactOp[], changes: CodexChange[], factChanges: FactChange[], depth: number): { ops: CodexOp[]; facts: FactOp[] } {
  const dOps = draftOps(changes, depth);
  const bases = new Map(changes.flatMap((c) => (c.shared ? [[c.shared.id, c.shared] as const] : [])));
  return { ops: [...ops, ...resolveShared(dOps, bases)], facts: [...facts, ...sharedFactOps(dOps, bases), ...draftFactOps(factChanges, depth)] };
}

/** The draft's fact changes as fact ops at `depth`, after everything posted. */
export function draftFactOps(changes: FactChange[], depth: number): FactOp[] {
  return changes.map((c, i) => ({
    ...c,
    id: `draft-op-${c.fact_id}`,
    anchor_chapter_id: DRAFT_ANCHOR,
    anchor_depth: depth,
    posted_at: i, // kept in the order they were made
  }));
}

/** Which fields differ between two versions, for a one-line "changed: ..." summary. */
export function changedFields(prev: CodexOp | undefined, next: CodexOp): string[] {
  if (!prev || prev.op === "retire") return next.op === "retire" ? [] : ["created"];
  const out: string[] = [];
  if (prev.name !== next.name) out.push("name");
  if (prev.type !== next.type) out.push("type");
  if (prev.aliases.join("|") !== next.aliases.join("|")) out.push("aliases");
  if (prev.content !== next.content) out.push("content");
  if (prev.always_include !== next.always_include) out.push("always include");
  return out;
}
