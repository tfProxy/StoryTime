"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { markDeskMove } from "@/lib/deskMove";

/**
 * A link to another chapter on the writing desk: it marks the move (see deskMove.ts), so the desk it opens keeps the
 * path's fold states, and leaves the scrolling to the desk (which scrolls to the chapter's box).
 */
export default function DeskLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  return (
    <Link
      {...rest}
      href={href}
      scroll={false}
      onClick={(e) => {
        markDeskMove(href);
        onClick?.(e);
      }}
    />
  );
}
