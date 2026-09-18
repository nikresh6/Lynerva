import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export default function MarketsPage() {
  return (
    <>
      <PageHeading
        title="Today’s top picks"
        description="Current regular-season NFL markets only. Lynerva evaluates both sides of each contract and ranks the side with the best modeled edge."
      />
      <MarketExplorer
        emptyMessage="No positive-edge NFL picks are available in the current snapshot."
      />
    </>
  );
}
