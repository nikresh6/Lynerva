import type { Metadata } from "next";
import { BuilderWorkbench } from "@/components/builder-workbench";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "Builder" };

export default function BuilderPage() {
  return (
    <>
      <PageHeading
        title="Builder"
        description="Choose a target return. Lynerva instantly builds from the same live, model-backed NFL picks."
      />
      <BuilderWorkbench />
    </>
  );
}
