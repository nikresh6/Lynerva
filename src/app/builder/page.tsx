import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";
import { getMarketOpportunities } from "@/lib/markets/service";

export const metadata: Metadata = { title: "Builder" };
export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const payload = await getMarketOpportunities();
  const eligibleMarkets = payload.opportunities
    .filter(
      (market) =>
        market.model.probabilityBps !== null &&
        market.edgeBps !== null &&
        market.edgeBps > 0 &&
        market.executablePriceBps !== null,
    )
    .toSorted(
      (first, second) =>
        (second.opportunityScore ?? -Infinity) -
        (first.opportunityScore ?? -Infinity),
    )
    .slice(0, 100);
  return (
    <>
      <PageHeading title="Builder" description="Find the highest-quality combination of currently executable contracts inside a target return range." />
      <BuilderWorkbench markets={eligibleMarkets} />
    </>
  );
}
