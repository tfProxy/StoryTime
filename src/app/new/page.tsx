import Link from "next/link";
import StoryDetailsForm from "@/components/StoryDetailsForm";
import { getDraft } from "@/lib/draftStore";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

// A new story starts with its details; its first chapter is written next, from its details page.
// A story begun on the old New story page (a draft holding the title, summary and first chapter together)
// fills in the form, and its chapter is kept as the new story's first-chapter draft.
export default function NewStoryPage() {
  const old = getDraft("story");
  const fromOld = old && (str(old.storyTitle) || str(old.premise) || str(old.title) || str(old.body)) ? old : null;
  return (
    <>
      <p className="crumbs">
        <Link href="/">← Stories</Link>
      </p>
      <h1>New story</h1>
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
  );
}
