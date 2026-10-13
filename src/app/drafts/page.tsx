import DraftList from "@/components/DraftList";

export default function DraftsPage() {
  return (
    <>
      <h1>Your drafts</h1>
      <p className="meta">Drafts are stored in this browser only. Clearing your browser data deletes them.</p>
      <DraftList />
    </>
  );
}
