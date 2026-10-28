import AiLogPage from "@/components/AiLogPage";

export const metadata = { title: "Prompt history" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

export default async function AiLogRoute({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filters = { source: one(sp.source), story: one(sp.story), chapter: one(sp.chapter), run: one(sp.run), item: one(sp.item) };
  // Keyed by the filters, so a link with other filters starts the page afresh.
  return <AiLogPage key={JSON.stringify(filters)} initial={filters} />;
}
