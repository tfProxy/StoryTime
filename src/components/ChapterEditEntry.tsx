"use client";

import type { StoryContext } from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import type { CodexOp, FactOp } from "@/lib/codex";
import ChapterEditor, { type Desk, type EditWriting } from "./ChapterEditor";
import StoryDetailsForm from "./StoryDetailsForm";

export type ChapterEditEntryProps = {
  chapterId: string;
  baseRevision: number;
  descendantCount: number;
  initialTitle: string;
  initialBody: string;
  initialSummary: string | null;
  initialPathSummary: string | null;
  existingChoices: { id: string; label: string; hasChild: boolean }[];
  incomingLabel: string | null;
  /** The choice leading here and the chapter it is on (the writing desk renames it). */
  incomingChoice?: { id: string; parentChapterId: string } | null;
  aiMarked: boolean;
  /** The owner made the summary theirs on the desk ("yours · not rewritten"). */
  summaryMine?: boolean;
  writing: EditWriting | null;
  context: StoryContext;
  storyId: string;
  draftLabel: string;
  /** The codex as of the previous chapter; absent for a story's first chapter. */
  codexPanel?: { chapterId: string; editing?: boolean; path: PathChapter[]; ops: CodexOp[]; facts?: FactOp[] };
  /** Present only for a story's first chapter. */
  story: { id: string; title: string; premise: string } | null;
  /** Inside the writing desk (see ChapterEditor). */
  desk?: Desk;
};

export default function ChapterEditEntry({ story, ...p }: ChapterEditEntryProps) {
  return (
    <>
      {/* The story's title and summary are also edited alongside its first chapter. */}
      {story && (
        <div style={{ marginBottom: "1.5rem" }}>
          <StoryDetailsForm story={story} />
        </div>
      )}
      <ChapterEditor
        target={{
          kind: "edit",
          chapterId: p.chapterId,
          baseRevision: p.baseRevision,
          descendantCount: p.descendantCount,
          initialTitle: p.initialTitle,
          initialBody: p.initialBody,
          initialSummary: p.initialSummary,
          initialPathSummary: p.initialPathSummary,
          existingChoices: p.existingChoices,
          incomingLabel: p.incomingLabel,
          incomingChoice: p.incomingChoice,
          aiMarked: p.aiMarked,
          summaryMine: p.summaryMine,
          writing: p.writing,
        }}
        context={p.context}
        storyId={p.storyId}
        draftKey={`edit:${p.chapterId}`}
        resumeHref={`/c/${p.chapterId}/edit`}
        draftLabel={p.draftLabel}
        codexPanel={p.codexPanel}
        desk={p.desk}
      />
    </>
  );
}
