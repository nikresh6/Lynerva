import type { Metadata } from "next";
import { MarketFiltersBar } from "@/components/market-filters";
import { MarketTable } from "@/components/market-table";
import { LiveGameStrip } from "@/components/live-game-strip";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { filterAndSortMarkets, parseMarketFilters } from "@/lib/markets/filters";
import { getMarketOpportunities } from "@/lib/markets/service";
import { getLiveNflGames } from "@/lib/nfl/live";

export const metadata: Metadata = { title: "Live markets" };
export const revalidate = 10;

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseMarketFilters({ ...params, status: "live" });
  const [payload, games] = await Promise.all([
    getMarketOpportunities(),
    getLiveNflGames(),
  ]);
  const markets = filterAndSortMarkets(payload.opportunities, filters)
    .filter((market) => market.isLive)
    .slice(0, 250);
  return (
    <>
      <PageHeading title="Live markets" description="Executable prices for NFL games in progress. Stale sources are labeled and never silently filled." />
      <LiveGameStrip games={games} />
      <MarketFiltersBar filters={filters} basePath="/live" />
      <SourceStatus providers={payload.providers} fixtureMode={payload.fixtureMode} />
      <MarketTable markets={markets} emptyMessage="No live NFL games right now." />
    </>
  );
}
