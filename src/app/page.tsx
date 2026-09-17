import { LiveRefresh } from "@/components/live-refresh";
import { MarketFiltersBar } from "@/components/market-filters";
import { MarketTable } from "@/components/market-table";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { filterAndSortMarkets, parseMarketFilters } from "@/lib/markets/filters";
import { getMarketOpportunities } from "@/lib/markets/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const filters = parseMarketFilters(params);
  const payload = await getMarketOpportunities();
  const markets = filterAndSortMarkets(payload.opportunities, filters).slice(
    0,
    250,
  );
  return (
    <>
      <LiveRefresh intervalMs={10_000} />
      <PageHeading title="Today’s top markets" />
      <MarketFiltersBar filters={filters} />
      <SourceStatus providers={payload.providers} fixtureMode={payload.fixtureMode} />
      <MarketTable markets={markets} />
    </>
  );
}
