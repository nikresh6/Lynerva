import { getMarketOpportunities } from "@/lib/markets/service";
import type { MarketOpportunity } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function score(market: MarketOpportunity) {
  return market.opportunityScore ?? -Infinity;
}

function balancedSnapshot(opportunities: MarketOpportunity[]) {
  const ranked = opportunities.toSorted((first, second) => score(second) - score(first));
  const selected: MarketOpportunity[] = [];
  const seen = new Set<string>();
  const perMatchup = new Map<string, number>();

  for (const market of ranked) {
    const matchup = market.canonical?.matchup ?? "unknown";
    const count = perMatchup.get(matchup) ?? 0;
    if (count >= 4) continue;
    const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
    if (seen.has(key)) continue;
    selected.push(market);
    seen.add(key);
    perMatchup.set(matchup, count + 1);
    if (selected.length >= 30) break;
  }

  return selected;
}

export async function GET() {
  const payload = await getMarketOpportunities();
  const opportunities = balancedSnapshot(payload.opportunities).map((market) => ({
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
