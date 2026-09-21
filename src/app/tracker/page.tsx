import type { Metadata } from "next";
import { ManualTracker } from "@/components/manual-tracker";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <>
      <PageHeading
        title="Your bets. Your real record."
        description="Track straights and parlays, compare the model’s entry estimate with the live market, and correct any final P/L without erasing the automatic calculation."
      />
      <ManualTracker />
    </>
  );
}
