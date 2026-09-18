import { getMarketOpportunities } from "@/lib/markets/service";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function score(market: MarketOpportunity) {
  return market.lynervaScore ?? -Infinity;
}

function topSnapshot(opportunities: MarketOpportunity[], limit = 30) {
  const seen = new Set<string>();
  const selected: MarketOpportunity[] = [];

  for (const market of opportunities.toSorted(
    (first, second) => score(second) - score(first),
  )) {
    const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(market);
    if (selected.length >= limit) break;
  }

  return selected;
}

function browserShortlist(opportunities: MarketOpportunity[]) {
  const globalTop = topSnapshot(opportunities, 30);
  const byPlatform = ["kalshi", "polymarket"].flatMap((platform) =>
    topSnapshot(
      opportunities.filter((market) => market.platform === platform),
      30,
    ),
  );
  const seen = new Set<string>();

  return [...globalTop, ...byPlatform].filter((market) => {
    const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  const payload = await getMarketOpportunities();
  const eligible = payload.opportunities.filter(isTopOpportunity);
  const opportunities = browserShortlist(eligible).map((market) => ({
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
        count: payload.opportunities.filter(
          (market) => market.platform === provider.provider,
        ).length,
        fetchedAt: provider.fetchedAt,
        error: provider.error,
      })),
      ratedCount: payload.opportunities.length,
      displayedCount: Math.min(30, eligible.length),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
      },
    },
  );
}
