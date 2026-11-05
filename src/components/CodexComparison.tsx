import Link from "next/link";
import ChapterTreePicker, { type PickerChapter } from "./ChapterTreePicker";
import type { EntryChange } from "@/lib/codex";

/** How the compared chapter stands to the one shown: earlier on its path, later on a branch from it, or on another branch. */
export type Relation = "earlier" | "later" | "branch";

/** The heading over a comparison: changes since an earlier chapter, by a later one, or against another branch. */
export function comparisonTitle(relation: Relation, other: string): string {
  if (relation === "earlier") return `Changes since “${other}”`;
  if (relation === "later") return `Changes by “${other}”`;
  return `Compared with “${other}” (another branch)`;
}

/**
 * "Compare with" and the chapter tree: picking a chapter reloads the page with `compare=<id>` (a plain form, so it
 * works on the server page). `keep` holds the page's other parameters.
 */
export function CompareForm({ chapters, keep, value, id }: { chapters: PickerChapter[]; keep: Record<string, string>; value: string | null; id: string }) {
  return (
    <form method="get" className="row compare-form">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span id={`${id}-label`}>Compare with</span>
      {/* With nothing compared yet, a link: the picker's button would read "The whole story". */}
      <ChapterTreePicker id={id} labelledBy={`${id}-label`} name="compare" submitOnPick chapters={chapters} value={value} linkLabel={value ? undefined : "Choose a chapter…"} />
    </form>
  );
}

/** One entry's changes: "Ears: round ears → tall fox ears", "+ Tail: bushy tail", "− Hair: long red hair". */
export function ChangeList({ changes }: { changes: EntryChange[] }) {
  return (
    <ul className="change-list">
      {changes.map((c, i) => (
        <li key={i} className={c.before === undefined ? "added" : c.after === undefined ? "removed" : "changed"}>
          <strong>{c.label}:</strong>{" "}
          {c.before === undefined ? (
            <>
              <span className="change-sign" aria-label="added">+</span> {c.after}
            </>
          ) : c.after === undefined ? (
            <>
              <span className="change-sign" aria-label="removed">−</span> <del>{c.before}</del>
            </>
          ) : (
            <>
              <del>{c.before}</del> <span aria-label="becomes">→</span> <ins>{c.after}</ins>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Stop comparing": the page without `compare`. */
export function StopComparing({ href }: { href: string }) {
  return (
    <Link href={href} className="meta">
      Stop comparing
    </Link>
  );
}
