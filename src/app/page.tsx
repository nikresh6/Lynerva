import { LiveRefresh } from "@/components/live-refresh";
import { MarketFiltersBar } from "@/components/market-filters";
import { MarketTable } from "@/components/market-table";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets, parseMarketFilters } from "@/lib/markets/filters";
import { getMarketOpportunities } from "@/lib/markets/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseMarketFilters(params);
  const payload = await getMarketOpportunities();
  const markets = filterAndSortMarkets(
    payload.opportunities.filter(isTopOpportunity),
    filters,
  ).slice(0, 100);

  return (
    <>
      <LiveRefresh intervalMs={10_000} />
      <PageHeading
        title="Today’s top picks"
        description="NFL single-leg markets only. Provider parlays and cross-category combos are excluded."
      />
      <MarketFiltersBar filters={filters} />
      <SourceStatus
        providers={payload.providers}
        fixtureMode={payload.fixtureMode}
      />
      <MarketTable
        markets={markets}
        emptyMessage="No model-backed NFL opportunities meet the bar right now."
      />
    </>
  );
}
