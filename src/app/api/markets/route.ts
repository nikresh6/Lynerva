import { getMarketOpportunities } from "@/lib/markets/service";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function score(market: MarketOpportunity) {
  return market.lynervaScore ?? -Infinity;
}

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

function browserShortlist(opportunities: MarketOpportunity[]) {
  const sorted = opportunities.toSorted(
    (first, second) => score(second) - score(first),
  );
  const groups = new Map<string, MarketOpportunity[]>();
  for (const market of sorted) {
    const key = groupKey(market);
    const group = groups.get(key) ?? [];
    if (group.length < 10) group.push(market);
    groups.set(key, group);
  }

  // Rank underlying bets, not individual alternate lines. Return the best 30
  // bet groups plus their alternate lines so the browser can expand them.
  const selectedGroups = [...groups.values()]
    .toSorted((a, b) => score(b[0]!) - score(a[0]!))
    .slice(0, 30);

  const seen = new Set<string>();
  return selectedGroups.flat().filter((market) => {
    const key = marketKey(market);
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
      displayedCount: Math.min(30, new Set(eligible.map(groupKey)).size),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
      },
    },
  );
}
