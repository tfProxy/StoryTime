import type { Metadata } from "next";
import Link from "next/link";
import AiLogRecorder from "@/components/AiLogRecorder";
import WorkQueueProvider from "@/components/WorkQueue";
import WorkQueueStatus from "@/components/WorkQueueStatus";
import HeaderActivity from "@/components/HeaderActivity";
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
        {/* Sends this browser's AI calls to the prompt history. */}
        <AiLogRecorder />
        {/* Holds the picture jobs for the whole app, so they go on while pages change. */}
        <WorkQueueProvider>
          <header className="site-header">
            <div className="site-header-row">
              <Link href="/" className="brand">
                StoryTime
              </Link>
              <div className="header-tools">
                <WorkQueueStatus />
                <SiteMenu />
              </div>
            </div>
            {/* What the AI is doing now, under the header's row; the header stays at the top of the window. */}
            <HeaderActivity />
          </header>
          <main>{children}</main>
        </WorkQueueProvider>
      </body>
    </html>
  );
}
