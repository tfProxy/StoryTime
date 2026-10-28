import Link from "next/link";
import { notFound } from "next/navigation";
import BulkSummaries from "@/components/BulkSummaries";
import CodexCheck from "@/components/CodexCheck";
import CodexEntryCards from "@/components/CodexEntryCards";
import CodexEntryList from "@/components/CodexEntryList";
import CodexInbox from "@/components/CodexInbox";
import ContinuityCheck from "@/components/ContinuityCheck";
import IssueActions from "@/components/IssueActions";
import MarkReviewedButton from "@/components/MarkReviewedButton";
import StoryChecks from "@/components/StoryChecks";
import StoryTagSwitches from "@/components/StoryTagSwitches";
import SummaryCheck from "@/components/SummaryCheck";
import TagScan from "@/components/TagScan";
import TagSuggestions from "@/components/TagSuggestions";
import TaggedChapters from "@/components/TaggedChapters";
import { listRuns } from "@/lib/aiRuns";
import { ENTRY_TYPES, foldCodex } from "@/lib/codex";
import { getCodexFacts, getCodexOps, storyCodexEntries } from "@/lib/codexDb";
import { codexPicturesAt } from "@/lib/codexPictures";
import { openSuggestionCounts } from "@/lib/codexSuggestions";
import { CHANGE_EVENT_TAGS } from "@/lib/continuity";
import { codexEntryFor, reviewIssues, type ReviewIssue } from "@/lib/review";
import { getPath, getStory } from "@/lib/stories";
import { chapterTags, decidedTagIdsByChapter, listTags, storyTags } from "@/lib/tags";
import { getStoryChapters } from "@/lib/tree";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "continuity", label: "Continuity" },
  { id: "codex", label: "Codex" },
  { id: "tags", label: "Tags" },
  { id: "summaries", label: "Summaries" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const UNFINISHED = ["queued", "running", "paused", "ready", "review"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The Story Bible: everything the app knows about a story and what needs a look, one tab each.
// `?tab=` picks the tab (Overview when missing) and `?chapter=` narrows every tab to one chapter.
export default async function StoryBiblePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string | string[]; tab?: string | string[]; type?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const story = getStory(id);
  const chapters = story ? getStoryChapters(id) : [];
  if (!story || chapters.length === 0) notFound();

  const wanted = Array.isArray(sp.chapter) ? sp.chapter[0] : sp.chapter;
  const chosen = chapters.find((c) => c.id === wanted);
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.find((t) => t.id === tabParam)?.id ?? "overview";
  const typeParam = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const entryType = ENTRY_TYPES.find((t) => t === typeParam) ?? null;
  const codexEntries = storyCodexEntries(story.id);
  const base = `/s/${story.id}/review`;
  const hrefFor = (t: Tab, chapterId = chosen?.id) => {
    const q = new URLSearchParams();
    if (t !== "overview") q.set("tab", t);
    if (chapterId) q.set("chapter", chapterId);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const treeChapters = chapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id }));

  // Issues, narrowed to the chosen chapter, by kind and status.
  type Issue = ReviewIssue;
  const all = reviewIssues(story.id);
  const scoped = chosen ? all.filter((i) => i.chapterId === chosen.id || i.continuity?.before.chapterId === chosen.id) : all;
  const byStatus = (list: Issue[]) => ({
    open: list.filter((i) => i.status === "open"),
    later: list.filter((i) => i.status === "later"),
    dismissed: list.filter((i) => i.status === "dismissed"),
  });
  const ai = byStatus(scoped.filter((i) => i.kind === "ai-unreviewed"));
  const summaryIssues = byStatus(scoped.filter((i) => i.kind !== "continuity" && i.kind !== "codex-missing" && i.kind !== "ai-unreviewed"));
  const clashes = byStatus(scoped.filter((i) => i.kind === "continuity"));
  const gaps = byStatus(scoped.filter((i) => i.kind === "codex-missing"));

  // Tags.
  const enabledIds = storyTags(story.id);
  const library = listTags();
  const tagRows = enabledIds.length > 0 ? chapterTags(story.id) : [];
  const tagsInScope = chosen ? tagRows.filter((t) => t.chapter_id === chosen.id) : tagRows;
  const waitingTags = tagsInScope.filter((t) => t.status === "suggested");
  const approvedTags = tagsInScope.filter((t) => t.status === "approved");

  const reviewRuns = listRuns(story.id, { mode: "review" });
  const unfinishedRun = (check: string, needsTasks = true) =>
    reviewRuns.find((r) => UNFINISHED.includes(r.status) && !r.options.automatic && (!needsTasks || r.counts.total > 0) && (r.options.checks ?? ["tags"]).includes(check as "tags"))?.id ?? null;

  const inbox = openSuggestionCounts(story.id);
  const counts: Record<Tab, number> = {
    overview: 0,
    issues: ai.open.length + summaryIssues.open.length,
    continuity: clashes.open.length,
    codex: gaps.open.length + (chosen ? (inbox.byChapter[chosen.id] ?? 0) : inbox.total),
    tags: waitingTags.length,
    summaries: 0,
  };

  return (
    <>
      <p className="crumbs">
        <Link href={`/s/${story.id}/outline`}>← Outline of {story.title}</Link>
      </p>
      <h1>Story Bible</h1>
      <form method="get" className="row" style={{ alignItems: "end", margin: "0.5rem 0 1rem" }}>
        {tab !== "overview" && <input type="hidden" name="tab" value={tab} />}
        <label htmlFor="bible-chapter" style={{ display: "grid", gap: "0.15rem" }}>
          <span className="meta" style={{ margin: 0 }}>Show</span>
          <select id="bible-chapter" name="chapter" defaultValue={chosen?.id ?? ""}>
            <option value="">The whole story</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {"· ".repeat(c.depth)}
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">
          Show
        </button>
      </form>
      {chosen && (
        <p className="meta">
          Showing “{chosen.title}” only · <Link href={hrefFor(tab, "")}>Show the whole story</Link>
        </p>
      )}
      <nav className="settings-tabs" aria-label="Story Bible">
        {TABS.map((t) => (
          <Link key={t.id} href={hrefFor(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            {t.label}
            {counts[t.id] > 0 && (
              <span className="count-chip" aria-label={`, ${counts[t.id]} open`}>
                {counts[t.id]}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="bible-panel">
        {tab === "overview" && overviewPanel()}
        {tab === "issues" && issuesPanel()}
        {tab === "continuity" && continuityPanel()}
        {tab === "codex" && codexPanel()}
        {tab === "tags" && tagsPanel()}
        {tab === "summaries" && summariesPanel()}
      </div>
    </>
  );

  function overviewPanel() {
    const card = (t: Tab, title: string, lines: string[]) => (
      <Link key={t} href={hrefFor(t)} className="card bible-card">
        <h2>
          {title}
          {counts[t] > 0 && <span className="count-chip">{counts[t]}</span>}
        </h2>
        {lines.map((l) => (
          <p key={l} className="meta">
            {l}
          </p>
        ))}
      </Link>
    );
    const summarised = chapters.filter((c) => c.summary?.trim()).length;
    const taggedChapters = new Set(approvedTags.map((t) => t.chapter_id)).size;
    const lastFinished = reviewRuns.filter((r) => r.status === "done" && r.finished_at).reduce<number | null>((m, r) => Math.max(m ?? 0, r.finished_at!), null);
    return (
      <>
        <div className="bible-cards">
          {card("issues", "Issues", [
            ...(ai.open.length > 0 ? [`${plural(ai.open.length, "chapter")} written by AI, not read yet`] : []),
            ...(summaryIssues.open.length > 0 ? [`${plural(summaryIssues.open.length, "summary problem")}`] : []),
            ...(counts.issues === 0 ? ["Nothing waiting."] : []),
          ])}
          {card(
            "continuity",
            "Continuity",
            clashes.open.length === 0
              ? ["No open clashes."]
              : [
                  ...clashes.open.slice(0, 2).map((i) => `${i.continuity!.entity} — ${i.continuity!.attribute}`),
                  ...(clashes.open.length > 2 ? [`and ${clashes.open.length - 2} more`] : []),
                ],
          )}
          {card("codex", "Codex", [
            gaps.open.length > 0 ? `${plural(gaps.open.length, "name")} not in the codex` : "No missing names found.",
            plural(codexEntries.length, "entry", "entries"),
          ])}
          {card(
            "tags",
            "Tags",
            enabledIds.length === 0
              ? ["No tags switched on for this story."]
              : [waitingTags.length > 0 ? `${plural(waitingTags.length, "suggestion")} waiting for you` : "No suggestions waiting.", ...(chosen ? [] : [`${taggedChapters} of ${plural(chapters.length, "chapter")} tagged`])],
          )}
          {card("summaries", "Summaries", [`${summarised} of ${plural(chapters.length, "chapter")} have a summary`])}
          <div className="card bible-card bible-card-plain">
            <h2>Checks</h2>
            <StoryChecks storyId={story!.id} lastFinished={lastFinished} withTags={enabledIds.length > 0} unfinishedRunId={unfinishedRun("summaries") && unfinishedRun("continuity", false) === unfinishedRun("summaries") ? unfinishedRun("summaries") : null} />
          </div>
        </div>
      </>
    );
  }

  // Open, Later and Dismissed lists of one kind of issue, as every tab shows them.
  function issueLists<A extends string>(
    lists: ReturnType<typeof byStatus>,
    render: (i: Issue, actions: A[]) => React.ReactNode,
    actions: { open: A[]; later: A[]; dismissed: A[] },
    empty: string,
    dismissedNote?: string,
  ) {
    return (
      <>
        {lists.open.length === 0 ? (
          <p>{lists.later.length + lists.dismissed.length > 0 ? "Nothing left to deal with here." : empty}</p>
        ) : (
          <ul>{lists.open.map((i) => render(i, actions.open))}</ul>
        )}
        {lists.later.length > 0 && (
          <>
            <h3>Later</h3>
            <ul>{lists.later.map((i) => render(i, actions.later))}</ul>
          </>
        )}
        {lists.dismissed.length > 0 && (
          <details>
            <summary>Dismissed ({lists.dismissed.length})</summary>
            {dismissedNote && <p className="meta">{dismissedNote}</p>}
            <ul>{lists.dismissed.map((i) => render(i, actions.dismissed))}</ul>
          </details>
        )}
      </>
    );
  }

  function issuesPanel() {
    type A = "later" | "dismissed" | "open" | "undo";
    const aiItem = (i: Issue, actions: A[]) => (
      <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
        <Link href={`/c/${i.chapterId}`}>{i.title}</Link>
        <br />
        {i.message} <MarkReviewedButton chapterId={i.chapterId} />
        <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={actions} />
      </li>
    );
    const summaryItem = (i: Issue, actions: A[]) => (
      <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
        <Link href={`/c/${i.chapterId}`}>{i.title}</Link>
        <br />
        {i.message} {!actions.includes("undo") && <Link href={`/c/${i.chapterId}/summary`}>Fix the summary</Link>}
        <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={actions} />
      </li>
    );
    return (
      <>
        <h2 id="written-by-ai">Written by AI</h2>
        {issueLists<A>(ai, aiItem, { open: ["later", "dismissed"], later: ["open", "dismissed"], dismissed: ["undo"] }, "Every chapter the AI wrote has been read.")}

        <h2>Summaries</h2>
        {issueLists<A>(
          summaryIssues,
          summaryItem,
          { open: ["later", "dismissed"], later: ["open", "dismissed"], dismissed: ["undo"] },
          chosen ? "This chapter's summary looks fine." : "Every chapter has a summary that matches its latest text.",
          "A dismissed issue comes back if the chapter is edited.",
        )}
        {!chosen && summaryIssues.open.length >= 2 && (
          <p>
            <Link href={hrefFor("summaries")}>Redo all the AI summaries</Link>
          </p>
        )}
        <SummaryCheck storyId={story!.id} unfinishedRunId={unfinishedRun("summaries")} chapterId={chosen?.id} chapters={treeChapters} />
      </>
    );
  }

  function continuityPanel() {
    type A = "later" | "dismissed" | "open" | "undo" | "intentional";
    const clash = (i: Issue, actions: A[]) => {
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
    return (
      <>
        <ContinuityCheck storyId={story!.id} unfinishedRunId={unfinishedRun("continuity", false)} chapterId={chosen?.id} chapters={treeChapters} />
        <h2>Clashes</h2>
        {issueLists<A>(
          clashes,
          clash,
          { open: ["later", "dismissed", "intentional"], later: ["open", "dismissed", "intentional"], dismissed: ["undo"] },
          "No continuity problems found yet.",
          "A dismissed problem comes back if the later chapter is edited.",
        )}
      </>
    );
  }

  function codexPanel() {
    type A = "later" | "dismissed" | "open" | "undo";
    const path = chosen ? getPath(chosen.id) : [];
    const gap = (i: Issue, actions: A[]) => (
      <li key={`${i.chapterId}-${i.kind}-${i.fingerprint}`}>
        <strong>{i.message.match(/^“(.*?)” comes up/)?.[1] ?? i.fingerprint}</strong> — first in <Link href={`/c/${i.chapterId}`}>{i.title}</Link> ·{" "}
        <Link href={hrefFor("codex", i.chapterId)}>Check the codex here</Link>
        <br />
        <span className="meta">{i.message}</span>
        <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={actions} />
      </li>
    );
    return (
      <>
        <h2 id="inbox">Codex inbox</h2>
        <CodexInbox storyId={story!.id} chapterId={chosen?.id} />

        <h2 id="codex">Not in the codex yet</h2>
        {gaps.open.length > 0 && <p className="meta">These names come up in several chapters on a path but have no codex entry.</p>}
        {issueLists<A>(gaps, gap, { open: ["later", "dismissed"], later: ["open", "dismissed"], dismissed: ["undo"] }, "No missing names found.", "A dismissed gap comes back if the chapter is edited.")}

        <h2>Check with the AI</h2>
        <p className="meta">The AI reads chapters and leaves suggested fact changes in the inbox above.</p>
        <CodexCheck storyId={story!.id} chapterId={chosen && path.length > 0 ? chosen.id : null} defaultOpen />

        {chosen ? (
          <section>
            <h2 id="entries">Entries as of “{chosen.title}”</h2>
            <CodexEntryCards
              entries={foldCodex(getCodexOps(chosen.id), getCodexFacts(chosen.id))}
              chapterId={chosen.id}
              storyId={story!.id}
              pictures={codexPicturesAt(story!.id, chosen.id)}
              empty="No entries at this chapter yet."
            />
          </section>
        ) : (
          <CodexEntryList storyId={story!.id} entries={codexEntries} type={entryType} baseHref={`${base}?tab=codex`} />
        )}
      </>
    );
  }

  function tagsPanel() {
    const storyId = story!.id;
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
    const rejected = tagsInScope.filter((t) => t.status === "rejected").length;
    const decidedBy = decidedTagIdsByChapter(storyId);

    // Chapters with approved tags, in story order; the chosen chapter always, so it can be tagged by hand.
    const tagged = chapters
      .filter((c) => (chosen ? c.id === chosen.id : approvedTags.some((t) => t.chapter_id === c.id)))
      .map((c) => ({
        id: c.id,
        title: c.title,
        tags: approvedTags.filter((t) => t.chapter_id === c.id).map((t) => ({ id: t.id, name: t.tag_name, value: t.value, source: t.source, stale: t.stale })),
        // A change-event tag (tf, tg) with no codex change posted at this chapter: offer to update the codex.
        codexOffer:
          approvedTags.some((t) => t.chapter_id === c.id && CHANGE_EVENT_TAGS.includes(t.tag_name.toLowerCase())) &&
          !getCodexOps(c.id).some((o) => o.anchor_chapter_id === c.id),
      }));

    return (
      <>
        {switches}
        <h2>Waiting for you</h2>
        {waitingTags.length === 0 ? (
          <p>{chosen ? "Nothing is waiting on this chapter." : "Nothing is waiting for your decision."}</p>
        ) : (
          <TagSuggestions
            items={waitingTags.map((t) => ({
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
          unfinishedRunId={unfinishedRun("tags")}
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

  function summariesPanel() {
    return (
      <>
        <p className="meta">
          The AI reads each chapter&apos;s summary instead of its full text when it continues the story. Redo them all in one go, for example after
          changing the summary style or the AI model.
        </p>
        <BulkSummaries story={{ title: story!.title, premise: story!.premise }} chapters={chapters} />
      </>
    );
  }
}
