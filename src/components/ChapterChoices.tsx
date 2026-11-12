import Link from "next/link";
import type { ChapterNote } from "@/lib/contentNotesRoll";
import { noteText } from "@/lib/contentNotesRoll";
import type { DraftMark } from "@/lib/draftMarks";
import type { Choice } from "@/lib/stories";
import AddChoice from "./AddChoice";
import AiMark from "./AiMark";
import DeskLink from "./DeskLink";
import OriginalPathToggle from "./OriginalPathToggle";
import RemoveChoice from "./RemoveChoice";
import SuggestChoices from "./SuggestChoices";

/**
 * "What happens next?": a chapter's choices as a vertical list (a row each: a written one opens its chapter, an unwritten
 * one starts writing it), then "Add a new suggestion" and "Suggest choices". On the reading page the links go to the
 * reading and Write pages; on the writing desk (`desk`) they stay on the desk: a written choice opens its chapter there,
 * an unwritten one its new chapter (`?choice=`), and "Draft a different idea" a new choice (`?new=`).
 * Rendered on the server (the reading page, the desk page) and handed to the page as it is.
 */
export default function ChapterChoices({
  storyId,
  chapterId,
  choices,
  incoming,
  marks,
  notes,
  trashed = false,
  hasOriginal = false,
  showOriginal = false,
  desk = false,
}: {
  storyId: string;
  chapterId: string;
  choices: Choice[];
  /** The choice the reader took to reach this chapter, if any (for Suggest choices). */
  incoming: string | null;
  /** "Draft not used" on a written choice, "draft" on an unwritten one (draftMarks.ts). */
  marks: Map<string, DraftMark>;
  /** The content notes under each written choice, by its chapter id. */
  notes: Map<string, ChapterNote>;
  /** The chapter is in the trash: the choices are only listed. */
  trashed?: boolean;
  /** The story has an original path (it was imported), with the switch that shows it. */
  hasOriginal?: boolean;
  showOriginal?: boolean;
  desk?: boolean;
}) {
  const markOriginal = hasOriginal && showOriginal;
  const ChoiceLink = desk ? DeskLink : Link;
  return (
    <section className={desk ? "choices desk-next" : "choices"} aria-label={desk ? "What happens next?" : undefined}>
      <div className="choices-head">
        <h2>{choices.length > 0 || desk ? "What happens next?" : "The story ends here, for now."}</h2>
        {hasOriginal && <OriginalPathToggle storyId={storyId} show={showOriginal} />}
      </div>
      {choices.map((c) =>
        trashed ? (
          // Nothing is written below a chapter in the trash; restore the branch first.
          <div key={c.id} className="card choice-unwritten">
            {c.label}
          </div>
        ) : c.child_chapter_id ? (
          <ChoiceLink key={c.id} href={desk ? `/c/${c.child_chapter_id}/desk` : `/c/${c.child_chapter_id}`} className="card choice-written" title="Written">
            <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z M12 6v13" />
            </svg>
            {c.label}
            {markOriginal && c.original && <span className="original-mark">Original</span>}
            {c.child_ai && (
              <span className="choice-ai">
                <AiMark mark={c.child_ai} />
              </span>
            )}
            {marks.get(c.id) === "unused" && <span className="desk-chip draft-mark">Draft not used</span>}
            {noteText(notes.get(c.child_chapter_id)) && <span className="choice-note">{noteText(notes.get(c.child_chapter_id))}</span>}
          </ChoiceLink>
        ) : (
          <div key={c.id} className="choice-slot">
            <ChoiceLink
              href={desk ? `/c/${chapterId}/desk?choice=${c.id}` : `/c/${chapterId}/write?choice=${c.id}`}
              className="card choice-unwritten"
              title={marks.get(c.id) === "draft" ? "Not written yet, but a draft is saved. Carry on with it?" : "Not written yet. Write it?"}
            >
              <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z M14.5 6.5l3 3" />
              </svg>
              {c.label}
              {markOriginal && c.original && <span className="original-mark">Original</span>}
              {marks.get(c.id) === "draft" && (
                <span className="choice-draft">
                  {/* A page with lines of text: the choice has a draft saved. */}
                  <svg className="choice-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6" />
                  </svg>
                  draft
                </span>
              )}
            </ChoiceLink>
            <RemoveChoice chapterId={chapterId} choiceId={c.id} label={c.label} />
          </div>
        ),
      )}
      {!trashed && (
        <>
          <AddChoice chapterId={chapterId} />
          <SuggestChoices storyId={storyId} chapterId={chapterId} incoming={incoming} choices={choices.map((c) => c.label)} draftHref={desk ? `/c/${chapterId}/desk?new=` : undefined} />
        </>
      )}
    </section>
  );
}
