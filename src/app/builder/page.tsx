import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";
import { isModelBackedOpportunity } from "@/lib/markets/eligibility";
import { getMarketOpportunities } from "@/lib/markets/service";

export const metadata: Metadata = { title: "Builder" };
export const revalidate = 10;

export default async function BuilderPage() {
  const payload = await getMarketOpportunities();
  const eligibleMarkets = payload.opportunities
    .filter(isModelBackedOpportunity)
    .toSorted(
      (first, second) =>
        (second.opportunityScore ?? -Infinity) -
        (first.opportunityScore ?? -Infinity),
    )
    .slice(0, 100);
  return (
    <>
      <PageHeading title="Builder" description="Choose a target return. Lynerva builds a custom combination from individual NFL markets only." />
      <BuilderWorkbench markets={eligibleMarkets} />
    </>
  );
}
