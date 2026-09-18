import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Builder" };

export default function BuilderPage() {
  return (
    <>
      <PageHeading
        title="Builder"
        description="Choose the structure, payout range, and risk style. Lynerva searches the live NFL market for the strongest combination."
      />
      <BuilderWorkbench />
    </>
  );
}
