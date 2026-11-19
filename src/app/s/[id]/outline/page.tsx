import Link from "next/link";
import { notFound } from "next/navigation";
import StoryTabs from "@/components/StoryTabs";
import { getStory, storyHasOriginal } from "@/lib/stories";
import OriginalPathToggle from "@/components/OriginalPathToggle";
import { getStoryTree, type TreeNode } from "@/lib/tree";
import { PageMenu } from "@/components/SiteMenu";
import { NodeSummary, SummaryProvider, ToggleAllSummaries } from "@/components/OutlineSummaries";
import { chapterImageVersions } from "@/lib/chapterImages";
import type { ImageVersions } from "@/lib/imageSlots";
import { getSettings } from "@/lib/settingsStore";
import { DEFAULT_OUTLINE, type OutlineOptions } from "@/lib/settingsSchema";
import { issueCounts } from "@/lib/review";

export const dynamic = "force-dynamic";

type Totals = { chapters: number; unwritten: number; ends: number; deepest: number };

function count(node: TreeNode, t: Totals) {
  t.chapters++;
  t.deepest = Math.max(t.deepest, node.depth + 1);
  if (node.choices.length === 0) t.ends++;
  for (const c of node.choices) {
    if (c.child) count(c.child, t);
    else t.unwritten++;
  }
}

/** The id of every chapter in the tree, trashed ones too (when the tree has them). */
function idsOf(node: TreeNode): string[] {
  return [node.id, ...node.choices.flatMap((c) => [...(c.child ? idsOf(c.child) : []), ...c.trashed.flatMap(idsOf)])];
}

function Node({
  node,
  via,
  images,
  issues,
  storyId,
  show,
  original = false,
}: {
  node: TreeNode;
  via: string | null;
  images: Map<string, ImageVersions>;
  /** How many things to check on the Review page, by chapter. */
  issues: Map<string, number>;
  storyId: string;
  /** The outline settings, plus `original`: mark the original path (an imported story, with its switch on). */
  show: OutlineOptions & { original?: boolean };
  /** Reached by the original story's choice (an imported story, with "Show the original path" on). */
  original?: boolean;
}) {
  // Only written chapters are listed; unwritten choices are left to the story page. A choice with trashed
  // chapters (shown only when the setting is on) lists them after its live one.
  const written = node.choices.flatMap((c) => [
    ...(c.child ? [{ node: c.child, label: c.label, original: show.original && c.original }] : []),
    ...c.trashed.map((t) => ({ node: t, label: c.label, original: false })),
  ]);
  const n = issues.get(node.id) ?? 0;
  // Only the links that are on; with none, NodeSummary shows only its own parts.
  const links = [
    n > 0 && (
      <Link
        key="review"
        className="outline-action outline-review"
        href={`/s/${storyId}/review?chapter=${node.id}`}
        title="Something to check on the Review page"
        aria-label={`${n} thing${n === 1 ? "" : "s"} to check`}
      >
        ⚠ {n}
      </Link>
    ),
    show.readToHere && (
      <Link key="read" className="outline-action" href={`/c/${node.id}/path`} title="Read every chapter from the first one to this one on a single page">
        read to here
      </Link>
    ),
  ].filter(Boolean);
  const summary = (
    <span className="outline-row">
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {original && <span className="original-mark">Original</span>}
      {node.trashed && <span className="meta outline-trashed-label">(trashed)</span>}
      {" "}
      <NodeSummary
        chapterId={node.id}
        title={node.title}
        images={images.get(node.id)!}
        summary={node.summary}
        via={via}
        show={show}
        ai={node.ai}
      >
        {links.length > 0 && links}
      </NodeSummary>
    </span>
  );
  const cls = node.trashed ? "outline-trashed" : undefined;
  if (written.length === 0) return <li id={`c-${node.id}`} className={cls}>{summary}</li>;
  return (
    <li id={`c-${node.id}`} className={cls}>
      {/* Everything starts open; a branch can still be folded away. */}
      <details open>
        <summary>{summary}</summary>
        <ul className="outline">
          {written.map((c) => (
            <Node key={c.node.id} node={c.node} via={c.label} original={c.original} images={images} issues={issues} storyId={storyId} show={show} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export default async function OutlinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  // The setting is read here, not in the browser, so trashed branches are never drawn first and then hidden.
  const show = (getSettings() ?? { outline: DEFAULT_OUTLINE }).outline;
  const tree = story ? getStoryTree(id, { trashed: show.trashed }) : null;
  if (!story || !tree) notFound();

  const totals: Totals = { chapters: 0, unwritten: 0, ends: 0, deepest: 0 };
  count(tree, totals);
  const hasOriginal = storyHasOriginal(id);
  const images = chapterImageVersions(idsOf(tree));
  const issues = show.review ? issueCounts(id) : new Map<string, number>();

  return (
    <div className="outline-page">
      <StoryTabs storyId={story.id} title={story.title} active="outline" />
      <h1>Outline</h1>
      <p className="meta">
        {totals.chapters} chapter{totals.chapters === 1 ? "" : "s"} · {totals.unwritten} choice
        {totals.unwritten === 1 ? "" : "s"} still to write · {totals.ends} branch{totals.ends === 1 ? "" : "es"} end · longest path{" "}
        {totals.deepest}
      </p>
      <SummaryProvider>
        {(show.summary || hasOriginal) && (
          <p className="row outline-switches">
            {show.summary && <ToggleAllSummaries />}
            {hasOriginal && <OriginalPathToggle storyId={story.id} show={story.show_original} />}
          </p>
        )}
        <ul className="outline outline-root">
          <Node node={tree} via={null} original={hasOriginal && story.show_original} images={images} issues={issues} storyId={story.id} show={{ ...show, original: hasOriginal && story.show_original }} />
        </ul>
      </SummaryProvider>
      <PageMenu>
        <Link href={`/s/${story.id}/pictures`}>Make missing pictures…</Link>
        <Link href={`/s/${story.id}/review?tab=summaries`}>Redo the AI summaries</Link>
      </PageMenu>
    </div>
  );
}
