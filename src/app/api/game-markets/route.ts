import { buildMarketClientPayload } from "@/lib/markets/client-payload";
import { getMarketOpportunitiesForMatchup } from "@/lib/markets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game")?.trim() ?? "";

  if (!game) {
    return Response.json(
      { opportunities: [], providers: [], ratedCount: 0, displayedCount: 0, fetchedAt: new Date().toISOString() },
      { status: 400 },
    );
  }

  const payload = buildMarketClientPayload(
    await getMarketOpportunitiesForMatchup(game),
  );

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
