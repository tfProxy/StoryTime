"use client";

import Link from "next/link";
import { useEditKey } from "@/lib/keys";

// Shown only in a browser that holds the chapter's edit key.
export default function EditLink({ chapterId }: { chapterId: string }) {
  const key = useEditKey(chapterId);
  if (!key) return null;
  return (
    <Link className="button secondary" href={`/c/${chapterId}/edit`}>
      Edit this chapter
    </Link>
  );
}
