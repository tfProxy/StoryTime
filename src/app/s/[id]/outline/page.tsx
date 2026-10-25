import Link from "next/link";
import { notFound } from "next/navigation";
import { getStory } from "@/lib/stories";
import { getStoryTree, type TreeNode } from "@/lib/tree";
import { PageMenu } from "@/components/SiteMenu";
import { NodeSummary, SummaryProvider, ToggleAllSummaries } from "@/components/OutlineSummaries";
import { chapterImageVersions } from "@/lib/chapterImages";
import type { ImageVersions } from "@/lib/imageSlots";
import { getSettings } from "@/lib/settingsStore";
import { DEFAULT_OUTLINE, type OutlineOptions } from "@/lib/settingsSchema";
import { issueCounts } from "@/lib/review";
import { appliedTagNames, pendingTagCounts } from "@/lib/tags";

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

/** The id of every chapter in the tree. */
function idsOf(node: TreeNode): string[] {
  return [node.id, ...node.choices.flatMap((c) => (c.child ? idsOf(c.child) : []))];
}

function Node({
  node,
  via,
  images,
  issues,
  tagNames,
  storyId,
  show,
}: {
  node: TreeNode;
  via: string | null;
  images: Map<string, ImageVersions>;
  issues: Map<string, { n: number; tags: boolean }>;
  /** Approved tag names by chapter; empty when tags are turned off in Settings. */
  tagNames: Map<string, string[]>;
  storyId: string;
  show: OutlineOptions;
}) {
  // Only written chapters are listed; unwritten choices are left to the story page.
  const written = node.choices.filter((c) => c.child);
  const n = issues.get(node.id)?.n ?? 0;
  // The marker opens the Review tab that has something; the tags tab only when tag suggestions are all there is.
  const tagsOnly = issues.get(node.id)?.tags ?? false;
  // Only the links that are on; none at all leaves NodeSummary's [...] without an empty part.
  const links = [
    n > 0 && (
      <Link
        key="review"
        className="outline-action outline-review"
        href={`/s/${storyId}/review?${tagsOnly ? "tab=tags&" : ""}chapter=${node.id}`}
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
    <>
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {" "}
      <NodeSummary
        chapterId={node.id}
        title={node.title}
        images={images.get(node.id)!}
        summary={node.summary}
        via={via}
        show={show}
        tags={tagNames.get(node.id) ?? []}
        ai={node.ai}
      >
        {links.length > 0 && links.flatMap((l, i) => (i === 0 ? [l] : [", ", l]))}
      </NodeSummary>
    </>
  );
  if (written.length === 0) return <li id={`c-${node.id}`}>{summary}</li>;
  return (
    <li id={`c-${node.id}`}>
      {/* Everything starts open; a branch can still be folded away. */}
      <details open>
        <summary>{summary}</summary>
        <ul className="outline">
          {written.map((c) => (
            <Node key={c.id} node={c.child!} via={c.label} images={images} issues={issues} tagNames={tagNames} storyId={storyId} show={show} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export default async function OutlinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  const tree = story ? getStoryTree(id) : null;
  if (!story || !tree) notFound();

  const totals: Totals = { chapters: 0, unwritten: 0, ends: 0, deepest: 0 };
  count(tree, totals);
  const images = chapterImageVersions(idsOf(tree));
  // Read here, not in the browser, so a part turned off in Settings is never drawn first and then hidden.
  const show = (getSettings() ?? { outline: DEFAULT_OUTLINE }).outline;
  const tagNames = show.tags ? appliedTagNames(id) : new Map<string, string[]>();
  const issues = new Map<string, { n: number; tags: boolean }>();
  if (show.review) {
    const checks = issueCounts(id);
    const pending = pendingTagCounts(id);
    for (const cid of new Set([...checks.keys(), ...pending.keys()])) {
      issues.set(cid, { n: (checks.get(cid) ?? 0) + (pending.get(cid) ?? 0), tags: !checks.has(cid) });
    }
  }

  return (
    <div className="outline-page">
      <h1>Outline</h1>
      <p className="meta">
        {totals.chapters} chapter{totals.chapters === 1 ? "" : "s"} · {totals.unwritten} choice
        {totals.unwritten === 1 ? "" : "s"} still to write · {totals.ends} branch{totals.ends === 1 ? "" : "es"} end · longest path{" "}
        {totals.deepest}
      </p>
      <SummaryProvider>
        {show.summary && (
          <p>
            <ToggleAllSummaries />
          </p>
        )}
        <ul className="outline outline-root">
          <Node node={tree} via={null} images={images} issues={issues} tagNames={tagNames} storyId={story.id} show={show} />
        </ul>
      </SummaryProvider>
      <PageMenu>
        <Link href={`/s/${story.id}/review`}>Review the story</Link>
        <Link href={`/s/${story.id}/summaries`}>Redo the AI summaries</Link>
      </PageMenu>
    </div>
  );
}
