import Link from "next/link";
import { notFound } from "next/navigation";
import StoryTabs from "@/components/StoryTabs";
import BibleScope from "@/components/BibleScope";
import BibleSectionSelect from "@/components/BibleSectionSelect";
import ChapterTreePicker from "@/components/ChapterTreePicker";
import CodexSection, { CodexBibleProvider, CodexMenu } from "@/components/CodexBible";
import ContinuityCheck from "@/components/ContinuityCheck";
import IssueActions from "@/components/IssueActions";
import MarkReviewedButton from "@/components/MarkReviewedButton";
import StoryChecks from "@/components/StoryChecks";
import StoryTagSwitches from "@/components/StoryTagSwitches";
import SummariesOverview, { type SummaryStatus } from "@/components/SummariesOverview";
import SummaryPanel from "@/components/SummaryPanel";
import TagScan from "@/components/TagScan";
import TagSuggestions from "@/components/TagSuggestions";
import TaggedChapters from "@/components/TaggedChapters";
import { listRuns } from "@/lib/aiRuns";
import { ChangeList, CompareForm, comparisonTitle, StopComparing, type Relation } from "@/components/CodexComparison";
import { compareEntry, foldCodex, retiredEntries, type CodexEntry, type EntryChange } from "@/lib/codex";
import { codexHintsFor, getCodexFacts, getCodexOps, getCodexState, storyCodexEntries } from "@/lib/codexDb";
import { listRetcons } from "@/lib/retcons";
import RetconList from "@/components/RetconList";
import RetconStart from "@/components/RetconStart";
import { DEFAULT_SETTINGS } from "@/lib/settingsSchema";
import { getSettings } from "@/lib/settingsStore";
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
  { id: "retcons", label: "Retcons" },
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
  searchParams: Promise<{ chapter?: string | string[]; tab?: string | string[]; review?: string | string[]; failed?: string | string[]; compare?: string | string[]; entry?: string | string[]; fact?: string | string[]; new?: string | string[] }>;
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
  const codexEntries = storyCodexEntries(story.id);
  const base = `/s/${story.id}/review`;
  const hrefFor = (t: Tab, chapterId = chosen?.id) => {
    const q = new URLSearchParams();
    if (t !== "overview") q.set("tab", t);
    if (chapterId) q.set("chapter", chapterId);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const pickerChapters = chapters.map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id, label: c.choice_label }));
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

  // How each chapter's summary stands (a dismissed issue doesn't count), for the Summaries section.
  const summaryStatus: Record<string, SummaryStatus> = {};
  for (const c of chapters) {
    const live = (kind: string) => all.some((i) => i.chapterId === c.id && i.kind === kind && i.status !== "dismissed");
    summaryStatus[c.id] = !c.summary?.trim() ? "missing" : live("summary-stale") ? "stale" : live("summary-wrong") ? "wrong" : !c.path_summary?.trim() ? "missing" : "done";
  }
  const summariesToFix = chapters.filter((c) => (!chosen || c.id === chosen.id) && (summaryStatus[c.id] === "missing" || summaryStatus[c.id] === "stale")).length;

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

  const retcons = listRetcons(story.id);
  const openRetconChanges = retcons
    .filter((r) => r.undone_at === null)
    .reduce((n, r) => n + r.changes.filter((c) => c.status === "open" && (!chosen || c.chapter_id === chosen.id)).length, 0);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const entryParam = one(sp.entry);
  const factParam = one(sp.fact);
  const newParam = one(sp.new);

  const inbox = openSuggestionCounts(story.id);
  const counts: Record<Tab, number> = {
    overview: 0,
    issues: ai.open.length + summaryIssues.open.length,
    continuity: clashes.open.length,
    codex: gaps.open.length + (chosen ? (inbox.byChapter[chosen.id] ?? 0) : inbox.total),
    tags: waitingTags.length,
    summaries: summariesToFix,
    retcons: openRetconChanges,
  };

  const rootId = story.root_chapter_id ?? chapters[0].id;
  const trail = chosen ? getPath(chosen.id).map((c) => c.title) : [];
  const page = (
    <>
      <StoryTabs storyId={story.id} title={story.title} active="bible" />
      <h1 className="visually-hidden">Story Bible</h1>
      {/* The sections: a select on a phone, the tab strip on a wider screen. The codex's ⋯ menu sits beside them. */}
      <div className="bible-nav">
        <div className="bible-section-pick">
          <BibleSectionSelect sections={TABS.map((t) => ({ id: t.id, label: t.label, href: hrefFor(t.id), open: counts[t.id] }))} active={tab} />
        </div>
        <nav className="settings-tabs bible-tabs" aria-label="Story Bible">
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
        {tab === "codex" && <CodexMenu />}
      </div>
      <BibleScope
        storyId={story.id}
        tab={tab}
        chapters={pickerChapters}
        chosen={chosen ? { id: chosen.id, title: chosen.title } : null}
        trail={trail}
      />

      <div className="bible-panel">
        {tab === "overview" && overviewPanel()}
        {tab === "issues" && issuesPanel()}
        {tab === "continuity" && continuityPanel()}
        {tab === "codex" && codexPanel()}
        {tab === "tags" && tagsPanel()}
        {tab === "summaries" && summariesPanel()}
        {tab === "retcons" && retconsPanel()}
      </div>
    </>
  );
  return tab === "codex" ? (
    <CodexBibleProvider storyId={story.id} chosenId={chosen?.id ?? null} anchorId={chosen?.id ?? rootId}>
      {page}
    </CodexBibleProvider>
  ) : (
    page
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
          {card("retcons", "Retcons", [
            counts.retcons > 0 ? `${plural(counts.retcons, "chapter")} with changes to look at` : retcons.length > 0 ? "Nothing waiting." : "No retcons yet.",
          ])}
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
        {i.message} {!actions.includes("undo") && <Link href={`${base}?tab=summaries&chapter=${i.chapterId}`}>Fix the summary</Link>}
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
    // The codex as of the chosen chapter on its branch, or every entry on any branch; the suggestions are read by the list itself.
    const path = getPath(chosen?.id ?? rootId);
    const entries = chosen ? foldCodex(getCodexOps(chosen.id), getCodexFacts(chosen.id)) : [];
    const reviewParam = Array.isArray(sp.review) ? sp.review[0] : sp.review;
    const hints = codexHintsFor(story!.id, chosen?.id ?? null, getSettings()?.contextTokens ?? DEFAULT_SETTINGS.contextTokens);
    return (
      <>
      {chosen && codexComparison(chosen, path, entries)}
      <CodexSection
        hintCounts={hints.counts}
        staleCounts={hints.stale}
        alwaysLoad={hints.always}
        path={path.map((c) => ({ id: c.id, title: c.title, depth: c.depth }))}
        entries={entries}
        pictures={chosen ? Object.fromEntries(Object.entries(codexPicturesAt(story!.id, chosen.id)).map(([entryId, p]) => [entryId, { id: p.id }])) : {}}
        pathIds={chosen ? path.map((c) => c.id) : []}
        summaries={codexEntries}
        entriesForShared={chosen ? entries : foldCodex(getCodexOps(rootId), getCodexFacts(rootId))}
        gaps={gaps.open.map((i) => ({
          chapterId: i.chapterId,
          fingerprint: i.fingerprint,
          name: i.message.match(/^“(.*?)” comes up/)?.[1] ?? i.fingerprint,
          count: Number(i.message.match(/comes up in (\d+) chapters/)?.[1] ?? 0),
        }))}
        retired={chosen ? retiredEntries(getCodexOps(chosen.id)).map((e) => ({ entry_id: e.entry_id, name: e.name, type: e.type, aliases: e.aliases, content: e.content, always_include: e.always_include })) : []}
        offerCheck={Boolean(reviewParam)}
      />
      </>
    );
  }

  /**
   * The Codex section at a chapter: "Compare with" a chapter, and with `compare=<id>` each entry that differs between the
   * two (earlier to later; across branches, from that chapter to this one), including entries that appear or leave.
   */
  function codexComparison(at: { id: string; title: string }, path: { id: string }[], entries: CodexEntry[]) {
    const compareId = Array.isArray(sp.compare) ? sp.compare[0] : sp.compare;
    const keep = { tab: "codex", chapter: at.id };
    const otherPath = compareId && compareId !== at.id ? getPath(compareId) : [];
    if (otherPath.length === 0 || otherPath[0].story_id !== story!.id) {
      return <CompareForm id="codex-compare" chapters={pickerChapters} keep={keep} value={null} />;
    }
    const other = otherPath[otherPath.length - 1];
    const relation: Relation = path.some((c) => c.id === other.id) ? "earlier" : otherPath.some((c) => c.id === at.id) ? "later" : "branch";
    const there = foldCodex(getCodexOps(other.id), getCodexFacts(other.id));
    const [from, to] = relation === "later" ? [entries, there] : [there, entries];
    const ids = [...new Set([...from, ...to].map((e) => e.entry_id))];
    const rows = ids.flatMap((entryId): { entryId: string; name: string; note: "new" | "gone" | null; changes: EntryChange[] }[] => {
      const a = from.find((e) => e.entry_id === entryId);
      const b = to.find((e) => e.entry_id === entryId);
      const name = (b ?? a)!.name;
      if (!a) return [{ entryId, name, note: "new", changes: [] }];
      if (!b) return [{ entryId, name, note: "gone", changes: [] }];
      const changes = compareEntry(a, b);
      return changes.length ? [{ entryId, name, note: null, changes }] : [];
    });
    return (
      <section className="codex-compare" aria-label="Comparison">
        <div className="row entry-compare-head">
          <h2>{comparisonTitle(relation, other.title)}</h2>
          <StopComparing href={hrefFor("codex", at.id)} />
        </div>
        {rows.length === 0 ? (
          <p className="meta">No changes: the codex is the same at both.</p>
        ) : (
          <ul className="codex-compare-list">
            {rows.map((r) => (
              <li key={r.entryId}>
                <Link href={`/s/${story!.id}/codex/${r.entryId}?at=${r.note === "gone" ? other.id : at.id}${r.note ? "" : `&compare=${other.id}`}`}>
                  <strong>{r.name}</strong>
                </Link>
                {r.note && <span className="meta"> · {r.note === "new" ? `added by “${relation === "later" ? other.title : at.title}”` : `not in the codex at “${relation === "later" ? other.title : at.title}”`}</span>}
                {r.changes.length > 0 && <ChangeList changes={r.changes} />}
              </li>
            ))}
          </ul>
        )}
        <CompareForm id="codex-compare" chapters={pickerChapters} keep={keep} value={other.id} />
      </section>
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
          <form method="get" className="row" style={{ alignItems: "start" }}>
            <input type="hidden" name="tab" value="tags" />
            <label id="tag-chapter-label" htmlFor="tag-chapter" style={{ paddingTop: "0.45rem" }}>
              Tag a chapter by hand
            </label>
            <ChapterTreePicker id="tag-chapter" labelledBy="tag-chapter-label" name="chapter" submitOnPick chapters={pickerChapters} value={chapters[0].id} />
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
    const storyInfo = { title: story!.title, premise: story!.premise };
    const unfinished = unfinishedRun("summaries");
    if (!chosen) {
      return (
        <>
          <p className="meta">
            The AI reads each chapter&apos;s summary instead of its full text when it continues the story. Redo them all in one go, for example after
            changing the summary style or the AI model.
          </p>
          <SummariesOverview storyId={story!.id} story={storyInfo} chapters={chapters} status={summaryStatus} unfinishedRunId={unfinished} />
        </>
      );
    }
    const failed = Array.isArray(sp.failed) ? sp.failed[0] : sp.failed;
    const wrong = scoped.filter((i) => i.kind === "summary-wrong" && i.status !== "dismissed");
    return (
      <SummaryPanel
        key={chosen.id}
        storyId={story!.id}
        chapterId={chosen.id}
        story={storyInfo}
        path={getPath(chosen.id).map((c) => ({ id: c.id, revision: c.revision, title: c.title, body: c.body, summary: c.summary, path_summary: c.path_summary }))}
        stale={summaryStatus[chosen.id] === "stale"}
        failed={failed}
        unfinishedRunId={unfinished}
        issues={
          wrong.length > 0 && (
            <ul className="summary-issues">
              {wrong.map((i) => (
                <li key={`${i.kind}-${i.fingerprint}`}>
                  {i.message}
                  <IssueActions chapterId={i.chapterId} kind={i.kind} fingerprint={i.fingerprint} actions={i.status === "later" ? ["open", "dismissed"] : ["later", "dismissed"]} />
                </li>
              ))}
            </ul>
          )
        }
      />
    );
  }

  // Retcons: the start form when asked for (a codex fact's Retcon…, or the chapter's "Retcon from here"), then every retcon.
  function retconsPanel() {
    const cancelHref = hrefFor("retcons");
    let form: React.ReactNode = null;
    if (chosen && entryParam && factParam) {
      const entry = getCodexState(chosen.id).find((e) => e.entry_id === entryParam);
      const fact = entry?.facts.find((f) => f.fact_id === factParam);
      form =
        entry && fact ? (
          <RetconStart
            storyId={story!.id}
            chapter={{ id: chosen.id, title: chosen.title }}
            fact={{ entryId: entry.entry_id, entryName: entry.name, factId: fact.fact_id, aspect: fact.aspect, form: fact.form, text: fact.text }}
            cancelHref={cancelHref}
          />
        ) : (
          <p className="error">That fact isn&apos;t in the codex at this chapter.</p>
        );
    } else if (chosen && newParam) {
      form = <RetconStart storyId={story!.id} chapter={{ id: chosen.id, title: chosen.title }} cancelHref={cancelHref} />;
    }
    return (
      <>
        {form ?? (
          <p className="meta">
            A retcon changes a detail as if it had always been so, and the AI proposes changes to the chapters below that no longer fit. Start one from a codex fact (Retcon… on the
            entry&apos;s page) or in words:{" "}
            {chosen ? <Link href={`${hrefFor("retcons")}&new=1`}>Retcon from “{chosen.title}”…</Link> : "pick a chapter above, then Retcon from here."}
          </p>
        )}
        <h2>Retcons</h2>
        <RetconList retcons={retcons} running={reviewRuns.filter((r) => UNFINISHED.includes(r.status)).map((r) => r.id)} />
      </>
    );
  }
}
