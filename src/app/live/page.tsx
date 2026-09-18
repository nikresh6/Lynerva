import type { Metadata } from "next";
import { LiveRefresh } from "@/components/live-refresh";
import { MarketFiltersBar } from "@/components/market-filters";
import { MarketTable } from "@/components/market-table";
import { LiveGameStrip } from "@/components/live-game-strip";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets, parseMarketFilters } from "@/lib/markets/filters";
import { getMarketOpportunities } from "@/lib/markets/service";
import { getLiveNflGames } from "@/lib/nfl/live";

export const metadata: Metadata = { title: "Live markets" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const markets = filterAndSortMarkets(
    payload.opportunities.filter(isTopOpportunity),
    filters,
  )
    .filter((market) => market.isLive)
    .slice(0, 100);
  return (
    <>
      <LiveRefresh intervalMs={5_000} />
      <PageHeading title="Live markets" description="Model-backed NFL single-leg opportunities for games in progress. Provider parlays are excluded." />
      <LiveGameStrip games={games} />
      <MarketFiltersBar filters={filters} basePath="/live" />
      <SourceStatus providers={payload.providers} fixtureMode={payload.fixtureMode} />
      <MarketTable markets={markets} emptyMessage="No live NFL games right now." />
    </>
  );
}
