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

/** The id of every chapter in the tree, trashed ones too (when the tree has them). */
function idsOf(node: TreeNode): string[] {
  return [node.id, ...node.choices.flatMap((c) => [...(c.child ? idsOf(c.child) : []), ...c.trashed.flatMap(idsOf)])];
}

type Mark = "hit" | "path" | "dim";

/** Marks every chapter for a highlighted tag: "hit" has it, "path" leads to one that does, the rest are "dim". Returns the number of hits. */
function markTree(node: TreeNode, hasTag: (chapterId: string) => boolean, marks: Map<string, Mark>): number {
  let below = 0;
  for (const c of node.choices) if (c.child) below += markTree(c.child, hasTag, marks);
  const hit = hasTag(node.id);
  marks.set(node.id, hit ? "hit" : below > 0 ? "path" : "dim");
  return below + (hit ? 1 : 0);
}

function Node({
  node,
  via,
  marks,
  images,
  issues,
  tagNames,
  storyId,
  show,
}: {
  node: TreeNode;
  via: string | null;
  /** What a highlighted tag makes of each chapter; null when nothing is highlighted. */
  marks: Map<string, Mark> | null;
  images: Map<string, ImageVersions>;
  issues: Map<string, { n: number; tags: boolean }>;
  /** Approved tag names by chapter; empty when tags are turned off in Settings. */
  tagNames: Map<string, string[]>;
  storyId: string;
  show: OutlineOptions;
}) {
  // Only written chapters are listed; unwritten choices are left to the story page. A choice with trashed
  // chapters (shown only when the setting is on) lists them after its live one.
  const written = node.choices.flatMap((c) => [...(c.child ? [{ node: c.child, label: c.label }] : []), ...c.trashed.map((t) => ({ node: t, label: c.label }))]);
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
  const mark = marks?.get(node.id);
  const summary = (
    <span className="outline-row" data-highlight={mark}>
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {node.trashed && <span className="meta outline-trashed-label">(trashed)</span>}
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
            <Node key={c.node.id} node={c.node} via={c.label} marks={marks} images={images} issues={issues} tagNames={tagNames} storyId={storyId} show={show} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export default async function OutlinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ highlight?: string | string[] }>;
}) {
  const { id } = await params;
  const { highlight: highlightParam } = await searchParams;
  const story = getStory(id);
  // The setting is read here, not in the browser, so trashed branches are never drawn first and then hidden.
  const show = (getSettings() ?? { outline: DEFAULT_OUTLINE }).outline;
  const tree = story ? getStoryTree(id, { trashed: show.trashed }) : null;
  if (!story || !tree) notFound();

  const totals: Totals = { chapters: 0, unwritten: 0, ends: 0, deepest: 0 };
  count(tree, totals);
  const images = chapterImageVersions(idsOf(tree));
  const tagNames = show.tags ? appliedTagNames(id) : new Map<string, string[]>();
  // Highlighting by tag: found from the approved tags whether or not the chips are shown.
  const approved = show.highlight ? appliedTagNames(id) : new Map<string, string[]>();
  const storyTags = [...new Set([...approved.values()].flat())].sort((a, b) => a.localeCompare(b));
  const wanted = (Array.isArray(highlightParam) ? highlightParam[0] : highlightParam)?.trim().toLowerCase();
  const highlighted = wanted ? storyTags.find((t) => t.toLowerCase() === wanted) : undefined;
  const marks = new Map<string, Mark>();
  const hits = highlighted
    ? markTree(tree, (cid) => approved.get(cid)?.some((t) => t.toLowerCase() === highlighted.toLowerCase()) ?? false, marks)
    : 0;
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
      {highlighted && (
        <p className="outline-highlight-note">
          Highlighting “{highlighted}”: {hits} chapter{hits === 1 ? "" : "s"}. <Link href={`/s/${story.id}/outline`}>Stop</Link>
        </p>
      )}
      <SummaryProvider>
        {show.summary && (
          <p>
            <ToggleAllSummaries />
          </p>
        )}
        <ul className="outline outline-root">
          <Node node={tree} via={null} marks={highlighted ? marks : null} images={images} issues={issues} tagNames={tagNames} storyId={story.id} show={show} />
        </ul>
      </SummaryProvider>
      <PageMenu>
        <Link href={`/s/${story.id}/pictures`}>Make missing pictures</Link>
        {storyTags.map((t) => (
          <Link key={t} href={`/s/${story.id}/outline?highlight=${encodeURIComponent(t)}`}>
            Highlight: {t}
          </Link>
        ))}
        {highlighted && <Link href={`/s/${story.id}/outline`}>Stop highlighting</Link>}
        <Link href={`/s/${story.id}/review?tab=summaries`}>Redo the AI summaries</Link>
      </PageMenu>
    </div>
  );
}
