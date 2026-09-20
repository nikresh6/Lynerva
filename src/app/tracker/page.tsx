import type { Metadata } from "next";
import { ManualTracker } from "@/components/manual-tracker";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <>
      <PageHeading
        title="Tracker"
        description="Track entries, live position movement, wins, losses, and cash outs without connecting a betting account."
      />
      <ManualTracker />
    </>
  );
}
