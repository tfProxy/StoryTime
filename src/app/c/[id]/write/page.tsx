import Link from "next/link";
import { notFound } from "next/navigation";
import { getChoices, getPath, getStory } from "@/lib/stories";
import ChapterEditor from "@/components/ChapterEditor";
import { getContextCodex } from "@/lib/codexDb";

export const dynamic = "force-dynamic";

export default async function WritePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ choice?: string }>;
}) {
  const { id } = await params;
  const { choice } = await searchParams;
  const path = getPath(id);
  if (path.length === 0) notFound();
  const parent = path[path.length - 1];

  let target: { kind: "fill"; choiceId: string; label: string } | { kind: "new"; parentChapterId: string };
  if (choice) {
    const slot = getChoices(id).find((c) => c.id === choice);
    if (!slot) notFound();
    if (slot.child_chapter_id) {
      return (
        <p>
          Someone already wrote that chapter. <Link href={`/c/${slot.child_chapter_id}`}>Read it</Link>.
        </p>
      );
    }
    target = { kind: "fill", choiceId: slot.id, label: slot.label };
  } else {
    target = { kind: "new", parentChapterId: parent.id };
  }

  const story = getStory(parent.story_id);
  if (!story) notFound();
  const choiceLabel = target.kind === "fill" ? target.label : null;
  const draftKey = target.kind === "fill" ? `fill:${target.choiceId}` : `new:${target.parentChapterId}`;
  const resumeHref = target.kind === "fill" ? `/c/${parent.id}/write?choice=${target.choiceId}` : `/c/${parent.id}/write`;
  const draftLabel =
    target.kind === "fill"
      ? `${story.title}: “${target.label}”`
      : `${story.title}: new choice after “${parent.title}”`;

  return (
    <>
      <p className="crumbs">
        <Link href={`/c/${parent.id}`}>← Back to “{parent.title}”</Link>
      </p>
      <h1>{target.kind === "fill" ? `Write: ${target.label}` : "Add a new choice"}</h1>
      <ChapterEditor
        target={target}
        context={{
          storyTitle: story.title,
          premise: story.premise,
          path: path.map((c) => ({ title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary })),
          choiceLabel,
          codex: getContextCodex(parent.id),
        }}
        draftKey={draftKey}
        resumeHref={resumeHref}
        draftLabel={draftLabel}
      />
    </>
  );
}
