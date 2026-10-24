import type { Metadata } from "next";

// The page itself is a client component, so its title is set here.
export const metadata: Metadata = { title: "Refine picture" };

export default function RefineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
