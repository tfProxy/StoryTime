"use client";

import { useState } from "react";
import { ENTRY_TYPES, TYPE_LABELS, type EntryType } from "@/lib/codex";
import { DEFAULT_CATEGORIES, categoriesFromText, categoriesToText, type CategoryLists } from "@/lib/codexCategories";

/**
 * Settings → Codex: the fact categories each type of entry may use, shared by every story. One text box per type, a
 * category a line ("Skin: What covers the body. (also: fur, scales)"), "# Body" for a heading. Saved when the box is left.
 */
export default function CategoryListsEditor({ lists, onChange }: { lists: CategoryLists; onChange: (next: CategoryLists) => void }) {
  const [type, setType] = useState<EntryType>("character");
  const [draft, setDraft] = useState<{ type: EntryType; text: string } | null>(null);
  const text = draft?.type === type ? draft.text : categoriesToText(lists[type]);
  const isDefault = categoriesToText(lists[type]) === categoriesToText(DEFAULT_CATEGORIES[type]);

  function commit() {
    if (!draft || draft.type !== type) return;
    onChange({ ...lists, [type]: categoriesFromText(draft.text) });
    setDraft(null);
  }

  return (
    <div className="category-lists">
      <h3>Fact categories</h3>
      <p className="meta">
        The categories a fact can be filed under, for every story. The AI must pick one of these, so it can&apos;t invent
        overlapping ones; a fact under another name it lists (“fur” for Skin) is filed under the category. When nothing
        fits, it suggests a new category for you to approve.
      </p>
      <label>
        Type of entry{" "}
        <select
          value={type}
          onChange={(e) => {
            commit();
            setType(e.target.value as EntryType);
          }}
        >
          {ENTRY_TYPES.filter((t) => t !== "note").map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <textarea
        aria-label={`Fact categories for a ${type}`}
        rows={14}
        spellCheck={false}
        value={text}
        onChange={(e) => setDraft({ type, text: e.target.value })}
        onBlur={commit}
      />
      <small>
        One category a line: <code>Name: what goes in it (also: other names)</code>. Add <code>[per form]</code> after the name
        for one that can differ between a character&apos;s forms (Skin, Tail); the rest (Personality, Relationships) are the
        same in every form. A line starting with <code>#</code> is a heading. Notes have no list.
      </small>
      <div className="row">
        <button type="button" disabled={isDefault && !draft} onClick={() => {
          setDraft(null);
          onChange({ ...lists, [type]: DEFAULT_CATEGORIES[type] });
        }}>
          Reset {TYPE_LABELS[type].toLowerCase()} list to the default
        </button>
      </div>
    </div>
  );
}
