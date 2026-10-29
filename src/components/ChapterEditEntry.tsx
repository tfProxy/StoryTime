"use client";

import type { StoryContext } from "@/lib/ai/prompts";
import type { PathChapter } from "@/lib/ai/codexAi";
import type { CodexOp, FactOp } from "@/lib/codex";
import ChapterEditor from "./ChapterEditor";
import StoryDetailsForm from "./StoryDetailsForm";

type Props = {
  chapterId: string;
  baseRevision: number;
  descendantCount: number;
  initialTitle: string;
  initialBody: string;
  initialSummary: string | null;
  initialPathSummary: string | null;
  existingChoices: { id: string; label: string; hasChild: boolean }[];
  incomingLabel: string | null;
  context: StoryContext;
  storyId: string;
  draftLabel: string;
  /** The codex as of the previous chapter; absent for a story's first chapter. */
  codexPanel?: { chapterId: string; editing?: boolean; path: PathChapter[]; ops: CodexOp[]; facts?: FactOp[] };
  /** Present only for a story's first chapter. */
  story: { id: string; title: string; premise: string } | null;
};

export default function ChapterEditEntry({ story, ...p }: Props) {
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
        }}
        context={p.context}
        storyId={p.storyId}
        draftKey={`edit:${p.chapterId}`}
        resumeHref={`/c/${p.chapterId}/edit`}
        draftLabel={p.draftLabel}
        codexPanel={p.codexPanel}
      />
    </>
  );
}
