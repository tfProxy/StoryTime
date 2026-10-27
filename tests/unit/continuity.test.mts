import { findConflicts, type PathFacts } from "../../src/lib/continuity.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const f = (entity: string, attribute: string, value: string, quote = `${entity} ${attribute} ${value}`) => ({ entity, attribute, value, quote });
const none = new Set<string>();

// empty path
ok(findConflicts([], none).length === 0, "empty path has no conflicts");

// matching values modulo case, spacing, "the", punctuation
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Mira", "eye colour", "Green")] },
    { chapterId: "b", facts: [f("Mira", "eye colour", "  green. ")] },
    { chapterId: "c", facts: [f("Mira", "eye  colour", "the   GREEN!")] },
  ];
  ok(findConflicts(path, none).length === 0, "case, spacing, 'the' and punctuation are ignored");
}

// a change reports one conflict with both chapters and quotes
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Mira", "eye colour", "green", "her green eyes")] },
    { chapterId: "b", facts: [f("Mira", "eye colour", "brown", "her brown eyes")] },
  ];
  const c = findConflicts(path, none);
  ok(c.length === 1, "a change gives one conflict");
  ok(c[0]?.before.chapterId === "a" && c[0]?.after.chapterId === "b", "conflict names both chapters");
  ok(c[0]?.before.quote === "her green eyes" && c[0]?.after.quote === "her brown eyes", "conflict carries both quotes");
  ok(c[0]?.before.value === "green" && c[0]?.after.value === "brown" && c[0]?.entity === "Mira", "conflict carries values and entity");
}

// a change on a change-event chapter is accepted and becomes the baseline
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Mira", "species", "human")] },
    { chapterId: "b", facts: [f("Mira", "species", "fox")] },
    { chapterId: "c", facts: [f("Mira", "species", "fox")] },
    { chapterId: "d", facts: [f("Mira", "species", "human")] },
  ];
  ok(findConflicts(path.slice(0, 3), new Set(["b"])).length === 0, "change on a change-event chapter is accepted");
  const c = findConflicts(path, new Set(["b"]));
  ok(c.length === 1 && c[0].before.value === "fox" && c[0].before.chapterId === "c" && c[0].after.chapterId === "d", "new value is the baseline; before is the latest chapter stating it");
}

// a later reversion is reported once per change
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Tom", "hair", "black")] },
    { chapterId: "b", facts: [f("Tom", "hair", "red")] },
    { chapterId: "c", facts: [f("Tom", "hair", "red")] },
    { chapterId: "d", facts: [f("Tom", "hair", "black")] },
    { chapterId: "e", facts: [f("Tom", "hair", "black")] },
  ];
  const c = findConflicts(path, none);
  ok(c.length === 2, "two changes give two conflicts, none repeated");
  ok(c[0].after.chapterId === "b" && c[1].after.chapterId === "d", "conflicts are in path order");
}

// separate keys do not interfere
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Tom", "hair", "black"), f("Mira", "hair", "red"), f("Tom", "age", "20")] },
    { chapterId: "b", facts: [f("Tom", "hair", "black"), f("Mira", "hair", "red"), f("Tom", "age", "20")] },
  ];
  ok(findConflicts(path, none).length === 0, "different entities and attributes are tracked separately");
}

// same-chapter contradiction
{
  const path: PathFacts[] = [{ chapterId: "a", facts: [f("Tom", "hair", "black"), f("Tom", "hair", "red")] }];
  const c = findConflicts(path, none);
  ok(c.length === 1 && c[0].before.chapterId === "a" && c[0].after.chapterId === "a", "same-chapter contradiction is reported");
  ok(findConflicts(path, new Set(["a"])).length === 0, "same-chapter contradiction is skipped on a change-event chapter");
}

// entity case differences match
{
  const path: PathFacts[] = [
    { chapterId: "a", facts: [f("Mira", "hair", "red")] },
    { chapterId: "b", facts: [f("MIRA ", "Hair", "black")] },
  ];
  const c = findConflicts(path, none);
  ok(c.length === 1 && c[0].entity === "MIRA " && c[0].attribute === "Hair", "entity and attribute match ignoring case; names come from the later fact");
}
