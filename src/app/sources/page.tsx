import type { Metadata } from "next";
import { SourceDashboard } from "@/components/source-dashboard";
import { getProjectionSourcePerformance } from "@/lib/model/source-performance";

export const metadata: Metadata = {
  title: "Projection sources",
  description:
    "See when every NFL projection source updated, how accurately it has performed by stat, and how that changes Huddlemark's model influence.",
};

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const now = new Date();
  const season = now.getUTCMonth() < 2
    ? now.getUTCFullYear() - 1
    : now.getUTCFullYear();
  const performance = await getProjectionSourcePerformance(season);

  return (
    <SourceDashboard
      season={performance.season}
      coverageWeek={performance.coverageWeek}
      rows={performance.rows}
      moneylineRows={performance.moneylineRows}
      sources={performance.sources}
      generatedAt={new Date().toISOString()}
    />
  );
}
