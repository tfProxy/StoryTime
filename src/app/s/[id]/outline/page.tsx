import Link from "next/link";
import { notFound } from "next/navigation";
import { getStory } from "@/lib/stories";
import { getStoryTree, type TreeNode } from "@/lib/tree";

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

function Node({ node, via }: { node: TreeNode; via: string | null }) {
  const summary = (
    <>
      {via && <span className="meta">{via} → </span>}
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {node.author_name && <span className="meta"> · {node.author_name}</span>}
      {node.edited && <span className="meta"> · edited</span>}
      {node.choices.length === 0 && <span className="tag"> · branch ends here</span>}
    </>
  );
  if (node.choices.length === 0) return <li>{summary}</li>;
  return (
    <li>
      {/* Deep branches start collapsed so a big story stays scannable. */}
      <details open={node.depth < 3}>
        <summary>{summary}</summary>
        <ul className="outline">
          {node.choices.map((c) =>
            c.child ? (
              <Node key={c.id} node={c.child} via={c.label} />
            ) : (
              <li key={c.id} className="outline-open">
                <span className="meta">{c.label} → </span>
                <span className="tag">not written yet</span>{" "}
                <Link href={`/c/${node.id}/write?choice=${c.id}`}>write it</Link>
              </li>
            ),
          )}
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

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}`}>← {story.title}</Link>
      </p>
      <h1>Outline</h1>
      <p className="meta">
        {totals.chapters} chapter{totals.chapters === 1 ? "" : "s"} · {totals.unwritten} choice
        {totals.unwritten === 1 ? "" : "s"} still to write · {totals.ends} branch{totals.ends === 1 ? "" : "es"} end · longest path{" "}
        {totals.deepest}
      </p>
      <ul className="outline outline-root">
        <Node node={tree} via={null} />
      </ul>
    </>
  );
}
