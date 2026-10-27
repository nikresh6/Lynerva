import type { Metadata } from "next";
import { ManualTracker } from "@/components/manual-tracker";
import { ModelTrackerWatchlist } from "@/components/model-tracker-watchlist";
import { getWeeklyScorecards } from "@/lib/model/scorecard";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const weekly = await getWeeklyScorecards();
  return (
    <>
      <PageHeading
        title="Your bets. Your real record."
        description="Track straights and parlays, compare the model’s entry estimate with the live market, and correct any final P/L without erasing the automatic calculation."
      />
      <ModelTrackerWatchlist week={weekly[0]} />
      <ManualTracker />
    </>
  );
}
