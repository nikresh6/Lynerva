import { getUpcomingScorecard } from "@/lib/model/scorecard";
import { resultsPickKey } from "@/lib/model/results-pick-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const week = await getUpcomingScorecard();
    const currentlySlated = week?.picks.filter(
      (pick) =>
        pick.trackingStatus === "slated" &&
        pick.platform &&
        pick.platformMarketId,
    ) ?? [];
    return Response.json(
      {
        week: week?.label ?? null,
        expectedPicks: week?.expectedPicks ?? 15,
        starred: currentlySlated.map((pick) => ({
          key: resultsPickKey({
            platform: pick.platform!,
            platformMarketId: pick.platformMarketId!,
            platformOutcomeId: pick.platformOutcomeId,
            side: pick.side,
          }),
          slot: pick.slot,
          lockAt: pick.lockAt,
        })),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Results shortlist unavailable", error);
    return Response.json(
      { error: "Results shortlist unavailable", starred: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
