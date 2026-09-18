import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Builder" };

export default function BuilderPage() {
  return (
    <>
      <PageHeading
        title="Builder"
        description="Build one parlay, or give Lynerva an amount and target payout to split across straight bets and parlays while controlling concentration and risk."
      />
      <BuilderWorkbench />
    </>
  );
}
