import type { Metadata } from "next";
import { LiveGameStrip } from "@/components/live-game-strip";
import { MarketExplorer } from "@/components/market-explorer";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Live NFL" };

export default function LivePage() {
  return (
    <>
      <PageHeading
        title="The live board."
        description="See the score, the player’s current stat, what is still needed, and why the probability moved—without decoding model jargon."
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
