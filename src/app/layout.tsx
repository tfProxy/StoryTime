import type { Metadata } from "next";
import Link from "next/link";
import SiteMenu from "@/components/SiteMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryTime",
  description: "Branching stories, written together with a little AI help",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            StoryTime
          </Link>
          <SiteMenu />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
