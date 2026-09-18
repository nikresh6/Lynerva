import { getMarketOpportunities } from "@/lib/markets/service";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function score(market: MarketOpportunity) {
  return market.lynervaScore ?? -Infinity;
}

function topSnapshot(opportunities: MarketOpportunity[]) {
  const seen = new Set<string>();
  const selected: MarketOpportunity[] = [];

  for (const market of opportunities.toSorted(
    (first, second) => score(second) - score(first),
  )) {
    const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(market);
    if (selected.length >= 30) break;
  }

  return selected;
}

export async function GET() {
  const payload = await getMarketOpportunities();
  const opportunities = topSnapshot(
    payload.opportunities.filter(isTopOpportunity),
  ).map((market) => ({
    ...market,
    resolutionRules: market.resolutionRules?.slice(0, 240) ?? null,
    model: {
      ...market.model,
      factors: market.model.factors.slice(0, 4),
    },
  }));

  return Response.json(
    {
      opportunities,
      providers: payload.providers.map((provider) => ({
        provider: provider.provider,
        count: opportunities.filter(
          (market) => market.platform === provider.provider,
        ).length,
        fetchedAt: provider.fetchedAt,
        error: provider.error,
      })),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
      },
    },
  );
}
