import { getMarketOpportunities } from "@/lib/markets/service";
import { isPricedOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";

export const runtime = "nodejs";
export const revalidate = 15;

function marketKey(market: MarketOpportunity) {
  return `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
}

function groupKey(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return marketKey(market);
  return [
    canonical.matchup,
    canonical.family,
    canonical.subject ?? "",
    canonical.statistic ?? "",
    market.recommendedSide ?? "",
  ].join(":");
}

export async function GET() {
  const payload = await getMarketOpportunities();
  const rated = payload.opportunities.filter(
    (market) => market.model.probabilityBps !== null,
  );
  const priced = rated.filter(isPricedOpportunity);
  const opportunities = priced.map((market) => ({
    ...market,
    resolutionRules: market.resolutionRules?.slice(0, 240) ?? null,
    model: {
      ...market.model,
      factors: market.model.factors.slice(0, 3),
    },
  }));

  return Response.json(
    {
      opportunities,
      providers: payload.providers.map((provider) => ({
        provider: provider.provider,
        count: payload.opportunities.filter(
          (market) => market.platform === provider.provider,
        ).length,
        fetchedAt: provider.fetchedAt,
        error: provider.error,
      })),
      ratedCount: rated.length,
      displayedCount: Math.min(30, new Set(priced.map(groupKey)).size),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=120",
      },
    },
  );
}
