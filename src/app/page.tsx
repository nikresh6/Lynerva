import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export default function MarketsPage() {
  return (
    <>
      <PageHeading
        title="Today’s top picks"
        description="The 30 strongest current NFL opportunities, ranked by a 0–100 score combining risk-adjusted value, hit evidence, model confidence, edge and market quality."
      />
      <MarketExplorer
        emptyMessage="No positive-edge NFL picks are available in the current snapshot."
      />
    </>
  );
}
