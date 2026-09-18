import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export default function MarketsPage() {
  return (
    <>
      <PageHeading
        title="Today’s top picks"
        description="We scan current NFL markets and show the 30 bets that look best based on the odds, our model, recent results, and how active the market is. Higher score means a stronger overall setup."
      />
      <MarketExplorer
        emptyMessage="No positive-edge NFL picks are available in the current snapshot."
      />
    </>
  );
}
