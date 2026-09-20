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
        description="Tonight’s game state and currently executable Kalshi prices. Live picks update as the score, clock, and market prices move."
      />
      <LiveGameStrip games={[]} />
      <MarketExplorer
        forceStatus="live"
        topOnly={false}
        emptyMessage="There are no executable modeled markets for the live game right now."
      />
    </>
  );
}
