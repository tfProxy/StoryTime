import Link from "next/link";
import { notFound } from "next/navigation";
import CodexAiScan from "@/components/CodexAiScan";
import ContinuityCheck from "@/components/ContinuityCheck";
import IssueActions from "@/components/IssueActions";
import StoryTagSwitches from "@/components/StoryTagSwitches";
import SummaryCheck from "@/components/SummaryCheck";
import TagScan from "@/components/TagScan";
import TagSuggestions from "@/components/TagSuggestions";
import TaggedChapters from "@/components/TaggedChapters";
import { listRuns } from "@/lib/aiRuns";
import { getCodexOps } from "@/lib/codexDb";
import { CHANGE_EVENT_TAGS } from "@/lib/continuity";
import { codexEntryFor, reviewIssues } from "@/lib/review";
import { getPath, getStory } from "@/lib/stories";
import { chapterTags, decidedTagIdsByChapter, listTags, storyTags } from "@/lib/tags";
import { getStoryChapters } from "@/lib/tree";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string | string[]; tab?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const story = getStory(id);
  const chapters = story ? getStoryChapters(id) : [];
  if (!story || chapters.length === 0) notFound();

  const wanted = Array.isArray(sp.chapter) ? sp.chapter[0] : sp.chapter;
  const chosen = chapters.find((c) => c.id === wanted);
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabParam === "tags" ? "tags" : "issues";
  const base = `/s/${story.id}/review`;
  const query = (t?: string) => {
    const q = new URLSearchParams();
    if (t) q.set("tab", t);
    if (chosen) q.set("chapter", chosen.id);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/outline`}>← Outline of {story.title}</Link>
      </p>
      <h1>Review</h1>
      <p className="meta">Things worth checking in this story. Nothing here changes the story until you act on it.</p>
      {chosen && (
        <p className="meta">
          Showing “{chosen.title}” only · <Link href={`${base}${tab === "tags" ? "?tab=tags" : ""}`}>Show the whole story</Link>
        </p>
      )}
      <nav className="settings-tabs" aria-label="Review">
        <Link href={`${base}${query()}`} aria-current={tab === "issues" ? "page" : undefined}>
          Issues
        </Link>
        <Link href={`${base}${query("tags")}`} aria-current={tab === "tags" ? "page" : undefined}>
          Tags
        </Link>
      </nav>

      {tab === "issues" ? issuesPanel(story.id) : tagsPanel(story.id)}
    </>
  );

  function issuesPanel(storyId: string) {
    const all = reviewIssues(storyId);
    const scoped = chosen ? all.filter((i) => i.chapterId === chosen.id || i.continuity?.before.chapterId === chosen.id) : all;
    const summaryScoped = scoped.filter((i) => i.kind !== "continuity" && i.kind !== "codex-missing");
    const gaps = scoped.filter((i) => i.kind === "codex-missing");
    const openGaps = gaps.filter((i) => i.status === "open");
    const laterGaps = gaps.filter((i) => i.status === "later");
    const dismissedGaps = gaps.filter((i) => i.status === "dismissed");
    const gap = (i: (typeof all)[number], actions: ("later" | "dismissed" | "open" | "undo")[]) => (
      <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
        <strong>{i.message.match(/^“(.*?)” comes up/)?.[1] ?? i.fingerprint}</strong> — first in <Link href={`/c/${i.chapterId}`}>{i.title}</Link> ·{" "}
        <Link href={`${base}?chapter=${i.chapterId}`}>Check the codex here</Link>
        <br />
        <span className="meta">{i.message}</span>
        <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={actions} />
      </li>
    );
    const issues = summaryScoped.filter((i) => i.status === "open");
    const later = summaryScoped.filter((i) => i.status === "later");
    const dismissed = summaryScoped.filter((i) => i.status === "dismissed");
    const clashes = scoped.filter((i) => i.kind === "continuity");
    const openClashes = clashes.filter((i) => i.status === "open");
    const laterClashes = clashes.filter((i) => i.status === "later");
    const dismissedClashes = clashes.filter((i) => i.status === "dismissed");
    const path = chosen ? getPath(chosen.id) : [];
    const clash = (i: (typeof all)[number], actions: ("later" | "dismissed" | "open" | "undo" | "intentional")[]) => {
      const c = i.continuity!;
      return (
        <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
          <strong>
            {c.entity} — {c.attribute}
          </strong>
          : “{c.before.value}” in <Link href={`/c/${c.before.chapterId}`}>{c.before.title}</Link>, then “{c.after.value}” in{" "}
          <Link href={`/c/${c.after.chapterId}`}>{c.after.title}</Link>
          <blockquote className="meta" style={{ margin: "0.25rem 0 0 0.5rem" }}>
            “{c.before.quote}”
          </blockquote>
          <blockquote className="meta" style={{ margin: "0.25rem 0 0.25rem 0.5rem" }}>
            “{c.after.quote}”
          </blockquote>
          {i.intentionalNote !== undefined && <p className="meta" style={{ margin: "0.25rem 0" }}>Intentional: {i.intentionalNote}</p>}
          <IssueActions
            chapterId={i.chapterId}
            kind={i.kind}
            fingerprint={i.fingerprint}
            actions={actions}
            entity={actions.includes("intentional") ? c.entity : undefined}
            codexEntry={actions.includes("intentional") ? (codexEntryFor(i.chapterId, c.entity)?.name ?? null) : undefined}
          />
        </li>
      );
    };
    const unfinishedContinuityRun =
      listRuns(storyId, { mode: "review" }).find(
        (r) => ["queued", "running", "paused", "ready", "review"].includes(r.status) && !r.options.automatic && (r.options.checks ?? ["tags"]).includes("continuity"),
      )?.id ?? null;
    const unfinishedSummaryRun =
      listRuns(storyId, { mode: "review" }).find(
        (r) => ["queued", "running", "paused", "ready", "review"].includes(r.status) && !r.options.automatic && r.counts.total > 0 && (r.options.checks ?? ["tags"]).includes("summaries"),
      )?.id ?? null;
    const item = (i: (typeof all)[number], actions: ("later" | "dismissed" | "open" | "undo")[], fix: boolean) => (
      <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
        <Link href={`/c/${i.chapterId}`}>{i.title}</Link>
        <br />
        {i.message} {fix && <Link href={`/c/${i.chapterId}/summary`}>Fix the summary</Link>}
        <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={actions} />
      </li>
    );
    return (
      <>
        <h2>Summaries</h2>
        {issues.length === 0 ? (
          <p>
            {later.length + dismissed.length > 0
              ? "Nothing left to deal with here."
              : chosen
                ? "This chapter's summary looks fine."
                : "Every chapter has a summary that matches its latest text."}
          </p>
        ) : (
          <>
            <ul>{issues.map((i) => item(i, ["later", "dismissed"], true))}</ul>
            {!chosen && issues.length >= 2 && (
              <p>
                <Link href={`/s/${storyId}/summaries`}>Redo all the AI summaries</Link>
              </p>
            )}
          </>
        )}
        {later.length > 0 && (
          <>
            <h3>Later</h3>
            <ul>{later.map((i) => item(i, ["open", "dismissed"], true))}</ul>
          </>
        )}
        {dismissed.length > 0 && (
          <details>
            <summary>Dismissed ({dismissed.length})</summary>
            <p className="meta">A dismissed issue comes back if the chapter is edited.</p>
            <ul>{dismissed.map((i) => item(i, ["undo"], false))}</ul>
          </details>
        )}
        <SummaryCheck
          storyId={storyId}
          unfinishedRunId={unfinishedSummaryRun}
          chapterId={chosen?.id}
          chapters={chapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id }))}
        />

        <h2>Continuity</h2>
        {openClashes.length === 0 ? (
          <p>{clashes.length > 0 ? "Nothing left to deal with here." : "No continuity problems found yet."}</p>
        ) : (
          <ul>{openClashes.map((i) => clash(i, ["later", "dismissed", "intentional"]))}</ul>
        )}
        {laterClashes.length > 0 && (
          <>
            <h3>Later</h3>
            <ul>{laterClashes.map((i) => clash(i, ["open", "dismissed", "intentional"]))}</ul>
          </>
        )}
        {dismissedClashes.length > 0 && (
          <details>
            <summary>Dismissed ({dismissedClashes.length})</summary>
            <p className="meta">A dismissed problem comes back if the later chapter is edited.</p>
            <ul>{dismissedClashes.map((i) => clash(i, ["undo"]))}</ul>
          </details>
        )}
        <ContinuityCheck
          storyId={storyId}
          unfinishedRunId={unfinishedContinuityRun}
          chapterId={chosen?.id}
          chapters={chapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id }))}
        />

        <h2 id="codex">Codex</h2>
        {openGaps.length > 0 && (
          <>
            <p className="meta">These names come up in several chapters on a path but have no codex entry.</p>
            <ul>{openGaps.map((i) => gap(i, ["later", "dismissed"]))}</ul>
          </>
        )}
        {laterGaps.length > 0 && (
          <>
            <h3>Later</h3>
            <ul>{laterGaps.map((i) => gap(i, ["open", "dismissed"]))}</ul>
          </>
        )}
        {dismissedGaps.length > 0 && (
          <details>
            <summary>Dismissed ({dismissedGaps.length})</summary>
            <p className="meta">A dismissed gap comes back if the chapter is edited.</p>
            <ul>{dismissedGaps.map((i) => gap(i, ["undo"]))}</ul>
          </details>
        )}
        <p className="meta">The AI checks one chapter at a time, or that chapter and the ones leading to it.</p>
        {chosen && path.length > 0 ? (
          <CodexAiScan
            story={{ title: story!.title, premise: story!.premise }}
            chapterId={chosen.id}
            path={path.map((c) => ({
              id: c.id,
              title: c.title,
              depth: c.depth,
              body: c.body,
              summary: c.summary,
              path_summary: c.path_summary,
            }))}
            ops={getCodexOps(chosen.id)}
            defaultOpen
          />
        ) : (
          <form method="get">
            <label htmlFor="review-chapter">Check the codex of</label>
            <select id="review-chapter" name="chapter">
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {"· ".repeat(c.depth)}
                  {c.title}
                </option>
              ))}
            </select>{" "}
            <button type="submit">Choose</button>
          </form>
        )}
      </>
    );
  }

  function tagsPanel(storyId: string) {
    const enabledIds = storyTags(storyId);
    const library = listTags();
    const switches = (
      <details open={enabledIds.length === 0}>
        <summary>
          Tags in this story
          {enabledIds.length > 0 && `: ${enabledIds.map((tid) => library.find((t) => t.id === tid)?.name).filter(Boolean).join(", ")}`}
        </summary>
        <StoryTagSwitches
          storyId={storyId}
          tags={library.map((t) => ({ id: t.id, name: t.name, applies: t.applies }))}
          enabled={enabledIds}
          heading={false}
        />
      </details>
    );
    if (enabledIds.length === 0) {
      return (
        <>
          {switches}
          {library.length > 0 && <p>Every tag is switched off for this story.</p>}
        </>
      );
    }
    const enabled = enabledIds.map((tid) => library.find((t) => t.id === tid)).filter((t) => !!t);
    const all = chapterTags(storyId);
    const inScope = chosen ? all.filter((t) => t.chapter_id === chosen.id) : all;
    const waiting = inScope.filter((t) => t.status === "suggested");
    const rejected = inScope.filter((t) => t.status === "rejected").length;
    const approved = inScope.filter((t) => t.status === "approved");

    const decidedBy = decidedTagIdsByChapter(storyId);

    // Chapters with approved tags, in story order; the chosen chapter always, so it can be tagged by hand.
    const tagged = chapters
      .filter((c) => (chosen ? c.id === chosen.id : approved.some((t) => t.chapter_id === c.id)))
      .map((c) => ({
        id: c.id,
        title: c.title,
        tags: approved.filter((t) => t.chapter_id === c.id).map((t) => ({ id: t.id, name: t.tag_name, value: t.value, source: t.source, stale: t.stale })),
        // A change-event tag (tf, tg) with no codex change posted at this chapter: offer to update the codex.
        codexOffer:
          approved.some((t) => t.chapter_id === c.id && CHANGE_EVENT_TAGS.includes(t.tag_name.toLowerCase())) &&
          !getCodexOps(c.id).some((o) => o.anchor_chapter_id === c.id),
      }));

    return (
      <>
        {switches}
        <h2>Waiting for you</h2>
        {waiting.length === 0 ? (
          <p>{chosen ? "Nothing is waiting on this chapter." : "Nothing is waiting for your decision."}</p>
        ) : (
          <TagSuggestions
            items={waiting.map((t) => ({
              id: t.id,
              chapter_id: t.chapter_id,
              chapter_title: t.chapter_title,
              tag_name: t.tag_name,
              value: t.value,
              quote: t.quote,
              reason: t.reason,
              stale: t.stale,
            }))}
          />
        )}
        {rejected > 0 && <p className="meta">{rejected} rejected suggestion{rejected === 1 ? " is" : "s are"} hidden.</p>}

        <h2>Tagged</h2>
        {tagged.length === 0 ? <p>No chapter has an approved tag yet.</p> : (
          <TaggedChapters
            storyId={storyId}
            chapters={tagged}
            enabled={enabled.map((t) => ({ id: t.id, name: t.name, choices: t.choices }))}
          />
        )}
        {!chosen && (
          <form method="get">
            <input type="hidden" name="tab" value="tags" />
            <label htmlFor="tag-chapter">Tag a chapter by hand</label>
            <select id="tag-chapter" name="chapter">
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {"· ".repeat(c.depth)}
                  {c.title}
                </option>
              ))}
            </select>{" "}
            <button type="submit">Choose</button>
          </form>
        )}

        <h2>Find tags</h2>
        <p className="meta">The AI reads each chapter and suggests which of this story&apos;s tags apply. You decide each one.</p>
        <TagScan
          storyId={storyId}
          unfinishedRunId={listRuns(storyId, { mode: "review" }).find((r) => ["queued", "running", "paused", "ready", "review"].includes(r.status) && !r.options.automatic && r.counts.total > 0 && (r.options.checks ?? ["tags"]).includes("tags"))?.id ?? null}
          story={{ title: story!.title, premise: story!.premise }}
          chapterId={chosen?.id}
          chapters={chapters.map((c) => ({
            id: c.id,
            title: c.title,
            body: c.body,
            revision: c.revision,
            parent_id: c.parent_id,
            decided: decidedBy.get(c.id) ?? [],
          }))}
          tags={enabled.map((t) => ({
            id: t.id,
            name: t.name,
            applies: t.applies,
            not_applies: t.not_applies,
            choices: t.choices,
            examples: t.examples,
          }))}
        />
      </>
    );
  }
}
