import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export default function MarketsPage() {
  return (
    <>
      <PageHeading
        title="Today’s top player props"
        description="Lynerva ranks current NFL player props using independent projection consensus, live game context, weather, market pricing, and, after four games, a separate current-season statistical model."
      />
      <MarketExplorer
        emptyMessage="No positive-edge NFL player props are available in the current snapshot."
      />
    </>
  );
}
