import Link from "next/link";
import { notFound } from "next/navigation";
import { chapterIdsOfRun, getRun, listRuns } from "@/lib/aiRuns";
import { chapterImageVersions } from "@/lib/chapterImages";
import { getStory } from "@/lib/stories";
import { getStoryTree, type TreeNode } from "@/lib/tree";
import MissingPictures, { type ScopeChapters } from "@/components/MissingPictures";
import { PageMenu } from "@/components/SiteMenu";

export const dynamic = "force-dynamic";

/** Every chapter of a tree in outline order, parents first. */
const inOrder = (n: TreeNode): TreeNode[] => [n, ...n.choices.flatMap((c) => (c.child ? inOrder(c.child) : []))];

// Make missing pictures: the header (and/or footer) picture of every chapter that has none, for the story, a chapter and
// everything below it (?from=<chapter>), or the chapters a write-ahead run wrote (?run=<run>). ?picrun=<id> shows a run of it.
export default async function MissingPicturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; run?: string; picrun?: string }>;
}) {
  const { id } = await params;
  const { from, run, picrun } = await searchParams;
  const story = getStory(id);
  if (!story) notFound();
  const tree = getStoryTree(id);
  const all = tree ? inOrder(tree) : [];
  const versions = chapterImageVersions(all.map((n) => n.id));
  const chapterOf = (n: TreeNode) => ({ id: n.id, title: n.title, hasHeader: versions.get(n.id)!.header !== null, hasFooter: versions.get(n.id)!.footer !== null });

  const scopes: ScopeChapters = { whole: all.map(chapterOf) };
  const start = from ? all.find((n) => n.id === from) : undefined;
  if (start) scopes.from = { id: start.id, title: start.title, chapters: inOrder(start).map(chapterOf) };
  if (run) {
    const wrote = new Set(chapterIdsOfRun(run));
    scopes.run = { id: run, chapters: all.filter((n) => wrote.has(n.id)).map(chapterOf) };
  }
  const unfinished = listRuns(id, { mode: "pictures" }).find((r) => ["queued", "running", "paused", "ready"].includes(r.status));
  // A run being shown must be this story's picture run.
  if (picrun) {
    let shown;
    try {
      shown = getRun(picrun);
    } catch {
      notFound();
    }
    if (shown.story_id !== id || shown.mode !== "pictures") notFound();
  }

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${id}/outline`}>← Back to the outline</Link>
      </p>
      <h1>Make missing pictures</h1>
      <p className="meta">
        For “{story.title}”. The AI writes a picture prompt for each chapter that has none of the pictures you ask for, and ComfyUI draws it. The picture is saved as the
        chapter&apos;s header or footer straight away.
      </p>
      <MissingPictures
        storyId={id}
        scopes={scopes}
        runId={picrun ?? null}
        unfinished={unfinished ? { id: unfinished.id, done: unfinished.counts.done, total: unfinished.counts.total } : null}
      />
      <PageMenu>
        <Link href={`/s/${id}/outline`}>Outline</Link>
      </PageMenu>
    </>
  );
}
