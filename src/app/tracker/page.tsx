import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeading } from "@/components/page-heading";
import { TrackerManager } from "@/components/tracker-manager";
import { TrackerSignIn } from "@/components/tracker-sign-in";
import { auth } from "@/lib/auth";
import { getPositions, positionView, trackerSummary } from "@/lib/tracker/data";

export const metadata: Metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return <><PageHeading title="Tracker" /><TrackerSignIn /></>;
  const positions = await getPositions();
  const views = positions.map(positionView).map((position) => ({ ...position, placedAt: position.placedAt.toISOString(), createdAt: undefined, updatedAt: undefined, userId: undefined }));
  return <><PageHeading title="Tracker" description="A restrained, manual record of your own positions and results." /><TrackerManager positions={views} summary={trackerSummary(positions)} today={new Date().toISOString().slice(0, 10)} /></>;
}
