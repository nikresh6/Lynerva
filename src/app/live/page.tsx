import type { Metadata } from "next";
import { LiveGameStrip } from "@/components/live-game-strip";
import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";
import { SourceStatus } from "@/components/source-status";
import { getMarketOpportunities } from "@/lib/markets/service";
import { getLiveNflGames } from "@/lib/nfl/live";

export const metadata: Metadata = { title: "Live NFL" };
export const revalidate = 5;

export default async function LivePage() {
  const [payload, games] = await Promise.all([
    getMarketOpportunities(),
    getLiveNflGames(),
  ]);

  return (
    <>
      <PageHeading
        title="Live NFL"
        description="Tonight’s game state and currently executable Kalshi/Polymarket prices. Live picks update as the score, clock, and market prices move."
      />
      <LiveGameStrip games={games} />
      <SourceStatus
        providers={payload.providers}
        fixtureMode={payload.fixtureMode}
      />
      <MarketExplorer
        initialMarkets={payload.opportunities}
        forceStatus="live"
        pollIntervalMs={5_000}
        emptyMessage="The game is visible above, but there is not a positive-edge live market in the latest snapshot."
      />
    </>
  );
}
