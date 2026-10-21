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

function Node({ node, via, images, show }: { node: TreeNode; via: string | null; images: Map<string, ImageVersions>; show: OutlineOptions }) {
  // Only written chapters are listed; unwritten choices are left to the story page.
  const written = node.choices.filter((c) => c.child);
  const summary = (
    <>
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {" "}
      <NodeSummary chapterId={node.id} title={node.title} images={images.get(node.id)!} summary={node.summary} via={via} show={show}>
        {show.readToHere && (
          <Link className="outline-action" href={`/c/${node.id}/path`} title="Read every chapter from the first one to this one on a single page">
            read to here
          </Link>
        )}
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
            <Node key={c.id} node={c.child!} via={c.label} images={images} show={show} />
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
          <Node node={tree} via={null} images={images} show={show} />
        </ul>
      </SummaryProvider>
      <PageMenu>
        <Link href={`/s/${story.id}/summaries`}>Redo the AI summaries</Link>
      </PageMenu>
    </div>
  );
}
