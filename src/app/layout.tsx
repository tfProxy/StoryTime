import type { Metadata } from "next";
import Link from "next/link";
import PictureQueueProvider from "@/components/PictureQueue";
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
        {/* Holds the picture jobs for the whole app, so they go on while pages change. */}
        <PictureQueueProvider>
          <header className="site-header">
            <Link href="/" className="brand">
              StoryTime
            </Link>
            <SiteMenu />
          </header>
          <main>{children}</main>
        </PictureQueueProvider>
      </body>
    </html>
  );
}
