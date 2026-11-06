// Making the story out of a reviewed import (see ./textImport): one chain of chapters joined by the original
// story's choices, which are marked `original`, plus the kept suggestions as unwritten choices.
import { db, newId } from "./db";
import { deleteDraft, getDraft } from "./draftStore";
import { PostError } from "./stories";
import { chapterBody, chapterRanges, importDraftKey, importPlanSchema, planProblems, type ImportDraft, type ImportPlan } from "./textImport";

export type ImportedStory = { story_id: string; chapter_id: string; chapter_ids: string[] };

/** Creates the story from the plan and the paragraphs; inside one transaction. */
export function createStoryFromPlan(plan: ImportPlan, paragraphs: string[]): ImportedStory {
  const problems = planProblems(plan, paragraphs.length);
  if (problems.length) throw new PostError(problems[0], 400);
  const ranges = chapterRanges(plan.chapters, paragraphs.length);
  const d = db();
  const t = Date.now();
  return d.transaction((): ImportedStory => {
    const storyId = newId();
    d.prepare(`INSERT INTO stories (id, title, premise, style, created_at) VALUES (?, ?, ?, ?, ?)`).run(storyId, plan.title.trim(), plan.premise.trim(), plan.style.trim(), t);
    const insertChapter = d.prepare(
      `INSERT INTO chapters (id, story_id, parent_choice_id, depth, title, body, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChoice = d.prepare(`INSERT INTO choices (id, parent_chapter_id, label, posted_at, original) VALUES (?, ?, ?, ?, ?)`);
    const chapterIds: string[] = [];
    let via: string | null = null;
    plan.chapters.forEach((c, i) => {
      const chapterId = newId();
      insertChapter.run(chapterId, storyId, via, i, c.title.trim(), chapterBody(paragraphs, ranges[i]), t);
      chapterIds.push(chapterId);
      via = null;
      if (i + 1 < plan.chapters.length) {
        via = newId();
        insertChoice.run(via, chapterId, c.choice.trim(), t, 1);
      }
      for (const a of c.alternatives) {
        if (a.keep && a.label.trim()) insertChoice.run(newId(), chapterId, a.label.trim(), t, 0);
      }
    });
    d.prepare(`UPDATE stories SET root_chapter_id = ? WHERE id = ?`).run(chapterIds[0], storyId);
    return { story_id: storyId, chapter_id: chapterIds[0], chapter_ids: chapterIds };
  })();
}

/** Creates the story from the import's saved draft (the review page saves its changes first), then drops the draft. */
export function createStoryFromImport(id: string): ImportedStory {
  const key = importDraftKey(id);
  const draft = getDraft(key) as ImportDraft | null;
  if (!draft || draft.kind !== "import") throw new PostError("That import is gone", 404);
  if (draft.status !== "ready" || !draft.plan) throw new PostError("The story hasn't been split into chapters yet", 409);
  const plan = importPlanSchema.safeParse(draft.plan);
  if (!plan.success) throw new PostError("The import's chapters aren't valid: split it again", 400);
  const made = createStoryFromPlan(plan.data, draft.paragraphs);
  deleteDraft(key);
  return made;
}
