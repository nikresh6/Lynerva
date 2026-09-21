import type { Metadata } from "next";
import { ResultsDashboard } from "@/components/results-dashboard";
import { getWeeklyScorecards } from "@/lib/model/scorecard";

export const metadata: Metadata = {
  title: "Weekly results",
  description:
    "A permanent weekly record of Huddlemark's top ten frozen NFL market picks, including hits, misses, hypothetical profit, and ROI.",
};

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const weeks = await getWeeklyScorecards();
  return <ResultsDashboard weeks={weeks} />;
}
