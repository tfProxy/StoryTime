import Link from "next/link";
import StoryDetailsForm from "@/components/StoryDetailsForm";
import ImportTextForm from "@/components/ImportTextForm";
import ImportStoryJson from "@/components/ImportStoryJson";
import { getDraft } from "@/lib/draftStore";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

// A new story starts with its details; its first chapter is written next, from its details page.
// A story begun on the old New story page (a draft holding the title, summary and first chapter together)
// fills in the form, and its chapter is kept as the new story's first-chapter draft.
// The Import tab (`?tab=import`) makes a story from a finished one: from text, or from a StoryTime JSON export.
export default async function NewStoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const importing = tab === "import";
  const old = importing ? null : getDraft("story");
  const fromOld = old && (str(old.storyTitle) || str(old.premise) || str(old.title) || str(old.body)) ? old : null;
  return (
    <>
      <p className="crumbs">
        <Link href="/">← Stories</Link>
      </p>
      <h1>New story</h1>
      <nav className="story-tabs new-story-tabs" aria-label="How to start">
        <Link href="/new" aria-current={importing ? undefined : "page"}>
          Write from scratch
        </Link>
        <Link href="/new?tab=import" aria-current={importing ? "page" : undefined}>
          Import a story
        </Link>
      </nav>
      {importing ? (
        <>
          <p className="meta">
            Paste a finished story or pick a text or Markdown file. The AI breaks it into short chapters at decision points and writes the
            choice taken at each one. Your text is kept word for word.
          </p>
          <ImportTextForm />
          <section className="import-json">
            <h2>Have a StoryTime export instead?</h2>
            <p className="meta">A JSON file from a story’s Details › Export makes a copy of that story.</p>
            <ImportStoryJson />
          </section>
        </>
      ) : (
        <>
          <p className="meta">Name the story and say what it is about. You write its first chapter next.</p>
          {fromOld && (
            <p className="ok" style={{ margin: 0 }}>
              The story you started before{str(fromOld.storyTitle) ? ` (“${str(fromOld.storyTitle)}”)` : ""} is filled in below. Create it to keep
              writing its first chapter{str(fromOld.title) ? `, “${str(fromOld.title)}”` : ""}.
            </p>
          )}
          <StoryDetailsForm
            heading="Title, summary and style"
            story={{ title: str(fromOld?.storyTitle), premise: str(fromOld?.premise), style: str(fromOld?.style) }}
            adoptDraft={fromOld !== null}
          />
        </>
      )}
    </>
  );
}
