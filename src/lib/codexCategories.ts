// The fact categories (aspects) a codex entry may use, one list per entry type, shared by every story and edited in
// Settings. The AI must pick from these, so it can't invent overlapping ones ("Personality" next to "Temperament").
// Pure code: used by server and browser.
import { ENTRY_TYPES, isFormAspect, sameAspect, type EntryType } from "./codex";

export type Category = {
  name: string;
  /** What belongs in it, for the AI and the owner. */
  about: string;
  /** Other names the AI may use for it; a fact under one of these is filed under `name`. */
  also: string[];
  /** A heading the list is grouped under ("Body"), or "". */
  group: string;
};

export type CategoryLists = Record<EntryType, Category[]>;

const c = (group: string, name: string, about: string, also: string[] = []): Category => ({ name, about, also, group });

export const DEFAULT_CATEGORIES: CategoryLists = {
  character: [
    c("Who", "Species", "What kind of being they are (human, fox, lizard). A character who changes has one for each form.", ["race", "kind", "creature"]),
    c("Who", "Sex", "Male, female, intersex and so on.", ["gender"]),
    c("Who", "Age", "Age in years, or how old they look.", []),
    c("Who", "Occupation", "Job, rank or role.", ["job", "profession", "role", "title", "rank"]),
    c("Body", "Height", "How tall they are.", ["size", "stature"]),
    c("Body", "Build", "Body shape, weight and muscle.", ["body", "figure", "physique", "frame"]),
    c("Body", "Skin", "What covers the body: skin, fur, scales or feathers, with its colour and texture.", ["fur", "scales", "feathers", "coat", "hide", "pelt", "plumage", "complexion", "skin colour"]),
    c("Body", "Hair", "Hair on the head, and any beard or mane.", ["beard", "mane", "hairstyle"]),
    c("Body", "Face", "Face shape, nose or muzzle, and usual expression.", ["muzzle", "snout", "nose", "features", "facial features"]),
    c("Body", "Eyes", "Eye colour, shape and pupils.", ["eye colour", "eye color", "pupils"]),
    c("Body", "Ears", "Ear shape and size.", []),
    c("Body", "Teeth", "Teeth, fangs, tongue and mouth.", ["mouth", "fangs", "tongue"]),
    c("Body", "Hands", "Hands, fingers, nails and claws.", ["claws", "fingers", "nails"]),
    c("Body", "Feet", "Feet, paws or hooves, and the legs.", ["paws", "hooves", "legs"]),
    c("Body", "Tail", "Tail shape, length and how it moves.", []),
    c("Body", "Wings", "Wings, if any.", []),
    c("Body", "Horns", "Horns or antlers.", ["antlers"]),
    c("Body", "Sexual Characteristics", "Genitals, breasts and other sexual traits.", ["genitals", "genitalia", "breasts", "anatomy", "sexual traits"]),
    c("Body", "Markings", "Scars, tattoos, spots, stripes and birthmarks.", ["scars", "tattoos", "patterns", "spots", "stripes"]),
    c("Body", "Scent", "How they smell.", ["smell", "odour", "odor", "musk"]),
    c("Look", "Clothing", "What they usually wear.", ["clothes", "outfit", "attire", "dress"]),
    c("Look", "Gear", "Weapons, tools and things they carry.", ["equipment", "weapons", "weapon", "items", "belongings"]),
    c("Manner", "Voice", "How they sound and speak.", ["speech", "accent"]),
    c("Manner", "Mannerisms", "Habits, gestures and how they move.", ["habits", "gestures", "gait", "posture", "quirks", "movement"]),
    c("Mind", "Personality", "Temperament and character.", ["temperament", "demeanor", "demeanour", "attitude", "traits", "nature"]),
    c("Mind", "Likes", "What they enjoy.", ["preferences", "interests", "hobbies"]),
    c("Mind", "Dislikes", "What they can't stand.", ["hates"]),
    c("Mind", "Fears", "What frightens them.", ["phobias"]),
    c("Mind", "Goals", "What they want.", ["motivation", "motivations", "desires", "ambitions", "wants"]),
    c("Mind", "Skills", "Things they have learned to do well.", ["talents", "expertise", "training"]),
    c("Mind", "Abilities", "Powers or magic beyond the ordinary.", ["powers", "magic"]),
    c("Life", "Relationships", "Ties to other characters.", ["family", "friends", "romance", "partner", "allies"]),
    c("Life", "Reputation", "How others see them.", ["standing", "fame"]),
    c("Life", "Secrets", "What they hide.", ["secret"]),
    c("Life", "History", "Their past.", ["background", "backstory", "past"]),
    c("Life", "Condition", "Health, injuries and state now.", ["status", "health", "injuries", "wounds", "state"]),
    c("Life", "Whereabouts", "Where they are now.", ["location", "current location"]),
  ],
  place: [
    c("", "Location", "Where it is.", ["position", "region"]),
    c("", "Size", "How big it is.", ["scale"]),
    c("", "Appearance", "What it looks like.", ["look", "description", "layout"]),
    c("", "Atmosphere", "Mood, sounds and smells.", ["mood", "ambience", "ambiance"]),
    c("", "Inhabitants", "Who lives there.", ["population", "residents", "people"]),
    c("", "Controlled by", "Who rules or owns it.", ["ruler", "owner", "government", "control"]),
    c("", "Customs", "Laws, traditions and how things are done.", ["rules", "laws", "culture", "traditions"]),
    c("", "Dangers", "Threats and hazards.", ["threats", "hazards"]),
    c("", "Resources", "Wealth, trade and what it has.", ["economy", "trade", "wealth"]),
    c("", "Condition", "Its state now.", ["status", "state"]),
    c("", "Secrets", "What is hidden there.", ["secret"]),
    c("", "History", "Its past.", ["background", "past"]),
  ],
  item: [
    c("", "Appearance", "What it looks like.", ["look", "description"]),
    c("", "Size", "Size and weight.", ["weight", "dimensions"]),
    c("", "Material", "What it is made of.", ["made of", "materials"]),
    c("", "Powers", "What it can do beyond the ordinary.", ["properties", "magic", "abilities", "enchantment"]),
    c("", "Use", "What it is for.", ["purpose", "function"]),
    c("", "Held by", "Who has it.", ["owner", "owned by", "wielder", "carried by"]),
    c("", "Whereabouts", "Where it is now.", ["location"]),
    c("", "Condition", "Its state now.", ["status", "state", "damage"]),
    c("", "Origin", "Who made it, and its past.", ["history", "maker", "made by"]),
  ],
  faction: [
    c("", "Purpose", "What the group wants.", ["goals", "aims", "mission"]),
    c("", "Leader", "Who leads it.", ["leaders", "head", "ruler"]),
    c("", "Members", "Who belongs to it.", ["membership", "ranks"]),
    c("", "Base", "Where it is based.", ["headquarters", "territory", "home"]),
    c("", "Symbols", "Emblems, colours and uniforms.", ["emblem", "insignia", "colours", "colors", "uniform"]),
    c("", "Resources", "Wealth and power it has.", ["wealth", "assets", "power"]),
    c("", "Allies", "Groups it works with.", []),
    c("", "Enemies", "Groups it fights.", ["rivals", "foes"]),
    c("", "Customs", "Rules, rituals and traditions.", ["rules", "rituals", "traditions", "laws"]),
    c("", "History", "Its past.", ["background", "past"]),
  ],
  lore: [
    c("", "Summary", "What it is, in short.", ["overview", "description"]),
    c("", "Rules", "How it works.", ["mechanics", "how it works"]),
    c("", "Limits", "What it can't do, and its weaknesses.", ["weaknesses", "restrictions"]),
    c("", "Cost", "What it takes to use.", ["price", "drawbacks"]),
    c("", "Who knows", "Who knows about it.", ["known by", "secrecy"]),
    c("", "History", "Its past.", ["origin", "background"]),
  ],
  note: [],
};

/**
 * Where an aspect the AI (or the owner) wrote fits: the entry's own spelling when it already has that aspect or one the
 * list files under the same category, else the list's name for it. `known` is false for an aspect that is on neither
 * the list nor the entry: a new category, which the owner approves before it is used.
 */
export function resolveAspect(aspect: string, list: Category[], have: { aspect: string }[] = []): { aspect: string; known: boolean } {
  const raw = aspect.replace(/^new( category)?\s*:\s*/i, "").trim();
  if (!raw || isFormAspect(raw)) return { aspect: raw, known: true };
  const own = have.find((f) => sameAspect(f.aspect, raw) && !isFormAspect(f.aspect));
  if (own) return { aspect: own.aspect.trim(), known: true };
  const cat = categoryOf(raw, list);
  if (!cat) return { aspect: raw, known: false };
  const filed = have.find((f) => f.aspect.trim() && categoryOf(f.aspect, list) === cat);
  return { aspect: filed ? filed.aspect.trim() : cat.name, known: true };
}

/** The category an aspect belongs to, by its name or one of its other names. */
export function categoryOf(aspect: string, list: Category[]): Category | null {
  return list.find((x) => sameAspect(x.name, aspect)) ?? list.find((x) => x.also.some((a) => sameAspect(a, aspect))) ?? null;
}

/** Whether an aspect is on the list (or the entry already uses it). */
export const isKnownAspect = (aspect: string, list: Category[], have: { aspect: string }[] = []) => resolveAspect(aspect, list, have).known;

/** The list for one type, as the AI reads it: "- Skin: what covers the body…", grouped under headings. */
export function categoryGuide(list: Category[]): string {
  const lines: string[] = [];
  let group = "";
  for (const x of list) {
    if (x.group && x.group !== group) lines.push(`${x.group}:`);
    group = x.group;
    lines.push(`${x.group ? "  " : ""}- ${x.name}${x.about ? `: ${x.about}` : ""}`);
  }
  return lines.join("\n");
}

/** The prompt rules for picking aspects, with the lists for the given types (each type once). */
export function aspectRules(lists: CategoryLists, types: EntryType[], opts: { newOnly?: boolean } = {}): string {
  const shown = ENTRY_TYPES.filter((t) => types.includes(t) && lists[t].length);
  const blocks = shown.map((t) => `Aspects for a ${t}:\n${categoryGuide(lists[t])}`);
  return [
    `Aspects: use only the aspects listed below${shown.length < types.length ? " (a note may use any)" : ""}, spelled as listed. Pick the one a detail fits best; never make up a near-duplicate (no "Temperament" when there is "Personality", no "Fur" when there is "Skin"). Only when nothing on the list fits, write "New: <Name>" as the aspect, for the author to approve.`,
    opts.newOnly
      ? `One fact per aspect (per form), about one detail; skip aspects the entry already has.`
      : `One fact per aspect (per form), about one detail: when an aspect already has a fact, give its whole new text, and it replaces the old one.`,
    `Don't record what something lacks ("Tail: none", "Wings: no wings"). When a feature is lost, use a "retire" item for it; when something never had it, say nothing.`,
    ...blocks,
  ].join("\n");
}

// ---- The lists as the owner edits them in Settings ----
//
// One text box per type, a category a line: "Skin: What covers the body. (also: fur, scales)", with "# Body" lines as
// headings.

export function categoriesToText(list: Category[]): string {
  const lines: string[] = [];
  let group = "";
  for (const x of list) {
    if (x.group !== group && x.group) lines.push(`${lines.length ? "\n" : ""}# ${x.group}`);
    group = x.group;
    const also = x.also.length ? ` (also: ${x.also.join(", ")})` : "";
    lines.push(`${x.name}${x.about || also ? `: ${x.about}${also}`.replace(/:\s+\(/, ": (") : ""}`);
  }
  return lines.join("\n");
}

export const CATEGORY_LIMITS = { name: 40, about: 200, also: 12, group: 30, perType: 80 };

/** The text box back into a list; blank lines are skipped and a name given twice is kept once. */
export function categoriesFromText(text: string): Category[] {
  const out: Category[] = [];
  let group = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      group = t.replace(/^#+/, "").trim().slice(0, CATEGORY_LIMITS.group);
      continue;
    }
    const colon = t.indexOf(":");
    const name = (colon < 0 ? t : t.slice(0, colon)).trim().slice(0, CATEGORY_LIMITS.name);
    let about = colon < 0 ? "" : t.slice(colon + 1).trim();
    let also: string[] = [];
    const m = about.match(/\(also:([^)]*)\)\s*$/i);
    if (m) {
      also = m[1].split(",").map((a) => a.trim().slice(0, CATEGORY_LIMITS.name)).filter(Boolean).slice(0, CATEGORY_LIMITS.also);
      about = about.slice(0, m.index).trim();
    }
    if (!name || isFormAspect(name) || out.some((x) => sameAspect(x.name, name))) continue;
    out.push({ name, about: about.slice(0, CATEGORY_LIMITS.about), also, group });
    if (out.length >= CATEGORY_LIMITS.perType) break;
  }
  return out;
}
