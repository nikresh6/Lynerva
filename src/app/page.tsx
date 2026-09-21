import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export default function MarketsPage() {
  return (
    <>
      <PageHeading
        title="Today’s NFL board, ranked."
        description="Start with the strongest model-versus-market disagreements. Every card separates the market price from Huddlemark’s estimate and opens into a plain-English explanation."
      />
      <MarketExplorer
        emptyMessage="No positive-edge NFL player props are available in the current snapshot."
      />
    </>
  );
}
