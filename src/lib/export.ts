import crypto from "node:crypto";
import { db } from "./db";
import { getStory } from "./stories";

// Whole-story exports. Only live content is included (removed chapters, choices and codex
// changes are left out), and nothing secret (edit-key hashes) ever appears.

type ChapterRow = {
  id: string;
  parent_choice_id: string | null;
  depth: number;
  title: string;
  body: string;
  summary: string | null;
  author_name: string;
  posted_at: number;
  edited_at: number | null;
  edited_by: string;
  revision: number;
};
type ChoiceRow = { id: string; parent_chapter_id: string; label: string; author_name: string; posted_at: number };

export type StoryExport = {
  story: { id: string; title: string; premise: string; author_name: string; created_at: number };
  /** In reading order: depth-first from the first chapter. */
  chapters: ChapterRow[];
  choices: ChoiceRow[];
  codex: Record<string, unknown>[];
};

/** Live chapters/choices of a story, keeping only those still reachable from the first chapter. */
export function loadStory(storyId: string): StoryExport | null {
  const story = getStory(storyId);
  if (!story?.root_chapter_id) return null;
  const allChapters = db()
    .prepare(
      `SELECT id, parent_choice_id, depth, title, body, summary, author_name, posted_at, edited_at, edited_by, revision
         FROM chapters WHERE story_id = ? AND removed_at IS NULL ORDER BY depth, posted_at, rowid`,
    )
    .all(storyId) as ChapterRow[];
  const allChoices = db()
    .prepare(
      `SELECT ch.id, ch.parent_chapter_id, ch.label, ch.author_name, ch.posted_at
         FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id
        WHERE c.story_id = ? AND ch.removed_at IS NULL ORDER BY ch.posted_at, ch.rowid`,
    )
    .all(storyId) as ChoiceRow[];

  // Walk down from the root so chapters hidden by a removed ancestor are excluded.
  const byChoice = new Map<string, ChapterRow>();
  for (const c of allChapters) if (c.parent_choice_id) byChoice.set(c.parent_choice_id, c);
  const choicesByParent = new Map<string, ChoiceRow[]>();
  for (const ch of allChoices) {
    choicesByParent.set(ch.parent_chapter_id, [...(choicesByParent.get(ch.parent_chapter_id) ?? []), ch]);
  }

  const chapters: ChapterRow[] = [];
  const choices: ChoiceRow[] = [];
  const visit = (c: ChapterRow) => {
    chapters.push(c);
    for (const ch of choicesByParent.get(c.id) ?? []) {
      choices.push(ch);
      const child = byChoice.get(ch.id);
      if (child) visit(child);
    }
  };
  const root = allChapters.find((c) => c.id === story.root_chapter_id);
  if (root) visit(root);

  const ids = new Set(chapters.map((c) => c.id));
  const codex = (
    db()
      .prepare(
        `SELECT id, anchor_chapter_id, entry_id, op, name, type, aliases, content, always_include, author_name, posted_at
           FROM codex_ops WHERE story_id = ? AND removed_at IS NULL ORDER BY posted_at, rowid`,
      )
      .all(storyId) as Record<string, unknown>[]
  )
    .filter((o) => ids.has(o.anchor_chapter_id as string))
    .map((o) => ({ ...o, aliases: safeJson(o.aliases), always_include: o.always_include === 1 }));

  return {
    story: { id: story.id, title: story.title, premise: story.premise, author_name: story.author_name, created_at: story.created_at },
    chapters,
    choices,
    codex,
  };
}

function safeJson(s: unknown): unknown {
  try {
    return JSON.parse(String(s));
  } catch {
    return [];
  }
}

export function toJson(data: StoryExport): string {
  return JSON.stringify({ format: "storytime-export", version: 1, exported_at: new Date().toISOString(), ...data }, null, 2);
}

/** Depth-first reading copy: each chapter numbered by its position in the tree (1, 1.1, 1.2.1 ...). */
export function toMarkdown(data: StoryExport): string {
  const choicesBy = new Map<string, ChoiceRow[]>();
  for (const c of data.choices) choicesBy.set(c.parent_chapter_id, [...(choicesBy.get(c.parent_chapter_id) ?? []), c]);
  const childBy = new Map<string, ChapterRow>();
  for (const c of data.chapters) if (c.parent_choice_id) childBy.set(c.parent_choice_id, c);

  // Number each chapter first so choices can point at their targets.
  const number = new Map<string, string>();
  const order: ChapterRow[] = [];
  const assign = (c: ChapterRow, label: string) => {
    number.set(c.id, label);
    order.push(c);
    (choicesBy.get(c.id) ?? []).forEach((ch, i) => {
      const child = childBy.get(ch.id);
      if (child) assign(child, `${label}.${i + 1}`);
    });
  };
  assign(data.chapters[0], "1");

  const out: string[] = [`# ${data.story.title}`];
  if (data.story.author_name) out.push(`*by ${data.story.author_name}*`);
  if (data.story.premise.trim()) {
    out.push(data.story.premise.trim().split("\n").map((l) => `> ${l}`).join("\n"));
  }
  out.push("*This is a branching story. Each chapter ends with choices that point to the numbered chapter they lead to.*");

  for (const c of order) {
    out.push(`## ${number.get(c.id)}. ${c.title}`);
    if (c.author_name) out.push(`*by ${c.author_name}*`);
    out.push(c.body.trim());
    const list = choicesBy.get(c.id) ?? [];
    if (list.length) {
      out.push(
        list
          .map((ch) => {
            const child = childBy.get(ch.id);
            return child ? `- **${ch.label}** → chapter ${number.get(child.id)}` : `- **${ch.label}** → *(not written yet)*`;
          })
          .join("\n"),
      );
    } else {
      out.push("*The end of this branch.*");
    }
  }
  return `${out.join("\n\n")}\n`;
}

/**
 * The playable part of a story, for exports that can't show "not written yet": a chapter is kept
 * if it ends the story (no choices) or has a choice that leads to a kept chapter. Choices nobody
 * has written yet, and chapters that can only lead to them, are left out. The first chapter always
 * stays so there is somewhere to start, even if nothing is finished yet.
 */
export function finishedBranches(data: StoryExport) {
  const childBy = new Map<string, ChapterRow>();
  for (const c of data.chapters) if (c.parent_choice_id) childBy.set(c.parent_choice_id, c);
  const choicesBy = new Map<string, ChoiceRow[]>();
  for (const c of data.choices) choicesBy.set(c.parent_chapter_id, [...(choicesBy.get(c.parent_chapter_id) ?? []), c]);

  const finished = new Map<string, boolean>();
  const isFinished = (c: ChapterRow): boolean => {
    const known = finished.get(c.id);
    if (known !== undefined) return known;
    const list = choicesBy.get(c.id) ?? [];
    const result = list.length === 0 || list.some((ch) => { const child = childBy.get(ch.id); return !!child && isFinished(child); });
    finished.set(c.id, result);
    return result;
  };
  const chapters = data.chapters.filter((c, i) => i === 0 || isFinished(c));
  const kept = new Set(chapters.map((c) => c.id));
  /** The chapter a choice leads to, if it is part of the playable story. */
  const leadsToKept = (ch: ChoiceRow) => {
    const child = childBy.get(ch.id);
    return !!child && kept.has(child.id) && isFinished(child);
  };
  return { chapters, childBy, choicesBy, leadsToKept };
}

/** Twee 3 source, importable into Twine 2 (Library > Import). Only finished branches are included. */
export function toTwee(data: StoryExport): string {
  const { chapters, childBy, choicesBy, leadsToKept } = finishedBranches(data);

  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const c of chapters) {
    const base = c.title.replace(/[[\]|<>]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    names.set(c.id, name);
  }
  // Twee uses "::" at the start of a line to begin a passage, and "[[" for links.
  const safe = (s: string) => s.replace(/^::/gm, ": :").replace(/\[\[/g, "[ [").replace(/\]\]/g, "] ]");
  const hex = crypto.createHash("sha1").update(data.story.id).digest("hex").toUpperCase();
  const ifid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-A${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

  const out: string[] = [
    `:: StoryTitle\n${data.story.title}`,
    `:: StoryData\n${JSON.stringify({ ifid, format: "Harlowe", "format-version": "3.3.8", start: names.get(chapters[0].id) }, null, 2)}`,
  ];
  for (const c of chapters) {
    const lines = [safe(c.body.trim()), ""];
    for (const ch of choicesBy.get(c.id) ?? []) {
      if (!leadsToKept(ch)) continue;
      const label = ch.label.replace(/[[\]|<>-]+/g, " ").replace(/\s+/g, " ").trim() || "Continue";
      lines.push(`[[${label}->${names.get(childBy.get(ch.id)!.id)}]]`);
    }
    out.push(`:: ${names.get(c.id)}\n${lines.join("\n").trimEnd()}`);
  }
  return `${out.join("\n\n")}\n`;
}

export const slug = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "story";
