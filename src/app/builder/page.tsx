import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Builder" };

export default function BuilderPage() {
  return (
    <>
      <PageHeading
        title="Build a ticket without the guesswork."
        description="Choose one parlay or a diversified bankroll plan. Huddlemark explains what it selected, the tradeoffs, and why a setup was rejected."
      />
      <BuilderWorkbench />
    </>
  );
}
