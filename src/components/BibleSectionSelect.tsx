"use client";

import { useRouter } from "next/navigation";

/** The Story Bible's sections as a labelled select, for a phone (a wider screen shows the tab strip instead). */
export default function BibleSectionSelect({ sections, active }: { sections: { id: string; label: string; href: string; open: number }[]; active: string }) {
  const router = useRouter();
  return (
    <label className="bible-section-select">
      <span className="meta">Section</span>
      <select value={active} onChange={(e) => router.push(sections.find((s) => s.id === e.target.value)?.href ?? "")}>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.open > 0 ? ` (${s.open} to review)` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
