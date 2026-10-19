import DraftList from "@/components/DraftList";

export default function DraftsPage() {
  return (
    <>
      <h1>Your drafts</h1>
      <p className="meta">Drafts are saved on the server as you write, so you can pick one up in any browser.</p>
      <DraftList />
    </>
  );
}
