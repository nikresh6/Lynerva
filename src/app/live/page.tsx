import type { Metadata } from "next";
import { LiveGameStrip } from "@/components/live-game-strip";
import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Live NFL" };

export default function LivePage() {
  return (
    <>
      <PageHeading
        title="Live NFL"
        description="Tonight’s game state and currently executable Kalshi/Polymarket prices. Live picks update as the score, clock, and market prices move."
      />
      <LiveGameStrip games={[]} />
      <MarketExplorer
        forceStatus="live"
        emptyMessage="The current game is visible above, but there is not a positive-edge live market in the latest snapshot."
      />
    </>
  );
}
