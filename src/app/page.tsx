import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { getMarketOpportunities } from "@/lib/markets/service";

export const revalidate = 10;

export default async function MarketsPage() {
  const payload = await getMarketOpportunities();

  return (
    <>
      <PageHeading
        title="Today’s top picks"
        description="Current regular-season NFL markets only. Lynerva evaluates both sides of each contract and ranks the side with the best modeled edge."
      />
      <SourceStatus
        providers={payload.providers}
        fixtureMode={payload.fixtureMode}
      />
      <MarketExplorer
        initialMarkets={payload.opportunities}
        pollIntervalMs={10_000}
        emptyMessage="No positive-edge NFL picks are available in the current snapshot."
      />
    </>
  );
}
