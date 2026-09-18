import type { Metadata } from "next";
import { ManualTracker } from "@/components/manual-tracker";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <>
      <PageHeading
        title="Tracker"
        description="Manual P/L tracking for your own bets. No betting account connection required."
      />
      <ManualTracker />
    </>
  );
}
