import { getMarketOpportunities } from "@/lib/markets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getMarketOpportunities();
  const opportunities = payload.opportunities
    .toSorted(
      (first, second) =>
        (second.opportunityScore ?? -Infinity) -
        (first.opportunityScore ?? -Infinity),
    )
    .slice(0, 800);

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
        "Cache-Control": "public, s-maxage=4, stale-while-revalidate=30",
      },
    },
  );
}
