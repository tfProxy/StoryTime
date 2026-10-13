import ChapterEditor from "@/components/ChapterEditor";

export default function NewStoryPage() {
  return (
    <>
      <h1>New story</h1>
      <p className="meta">You write the first chapter now. Once posted, it can&apos;t be edited.</p>
      <ChapterEditor
        target={{ kind: "story" }}
        context={{ storyTitle: "", premise: "", path: [], choiceLabel: null }}
        draftKey="story"
        resumeHref="/new"
        draftLabel="New story"
      />
    </>
  );
}
