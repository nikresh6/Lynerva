import { getMarketOpportunities } from "@/lib/markets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getMarketOpportunities();
  const opportunities = payload.opportunities
    .filter(
      (market) =>
        market.model.probabilityBps !== null ||
        market.arbitrage?.classification === "arbitrage",
    )
    .toSorted(
      (first, second) =>
        (second.opportunityScore ?? -Infinity) -
        (first.opportunityScore ?? -Infinity),
    )
    .slice(0, 400);

  return Response.json(
    {
      opportunities,
      providers: payload.providers.map((provider) => ({
        provider: provider.provider,
        count: provider.markets.length,
        fetchedAt: provider.fetchedAt,
        error: provider.error,
      })),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
