import type { Metadata } from "next";
import Link from "next/link";
import AiLogRecorder from "@/components/AiLogRecorder";
import WorkQueueProvider from "@/components/WorkQueue";
import WorkQueueStatus from "@/components/WorkQueueStatus";
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
        <AiLogRecorder />
        <WorkQueueProvider>
          <header className="site-header">
            <Link href="/" className="brand">
              StoryTime
            </Link>
            <div className="header-tools">
              <WorkQueueStatus />
              <SiteMenu />
            </div>
          </header>
          <main>{children}</main>
        </WorkQueueProvider>
      </body>
    </html>
  );
}
