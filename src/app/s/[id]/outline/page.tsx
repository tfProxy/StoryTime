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

function Node({ node, via, storyId }: { node: TreeNode; via: string | null; storyId: string }) {
  // Only written chapters are listed; unwritten choices are left to the story page.
  const written = node.choices.filter((c) => c.child);
  const summary = (
    <>
      {via && <span className="meta">{via} → </span>}
      <Link href={`/c/${node.id}`}>{node.title}</Link>
      {node.author_name && <span className="meta"> · {node.author_name}</span>}
      {node.edited && <span className="meta"> · edited</span>}
      {node.choices.length === 0 && <span className="tag"> · branch ends here</span>}
      {" "}
      <a
        className="meta outline-export"
        href={`/api/stories/${storyId}/export?format=md&to=${node.id}`}
        title="Download the route from the first chapter to this one as Markdown"
      >
        export path
      </a>
    </>
  );
  if (written.length === 0) return <li>{summary}</li>;
  return (
    <li>
      {/* Everything starts open; a branch can still be folded away. */}
      <details open>
        <summary>{summary}</summary>
        <ul className="outline">
          {written.map((c) => (
            <Node key={c.id} node={c.child!} via={c.label} storyId={storyId} />
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

  return (
    <div className="outline-page">
      <p className="crumbs">
        <Link href={`/s/${story.id}`}>← {story.title}</Link>
      </p>
      <h1>Outline</h1>
      <p className="meta">
        <Link href={`/s/${story.id}/summaries`}>Redo the AI summaries</Link>
      </p>
      <p className="meta">
        {totals.chapters} chapter{totals.chapters === 1 ? "" : "s"} · {totals.unwritten} choice
        {totals.unwritten === 1 ? "" : "s"} still to write · {totals.ends} branch{totals.ends === 1 ? "" : "es"} end · longest path{" "}
        {totals.deepest}
      </p>
      <ul className="outline outline-root">
        <Node node={tree} via={null} storyId={story.id} />
      </ul>
    </div>
  );
}
