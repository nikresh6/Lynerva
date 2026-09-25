import { getMarketOpportunities } from "@/lib/markets/service";
import { isPricedOpportunity } from "@/lib/markets/eligibility";
import {
  expectedRoi,
  lynervaScore,
  opportunityScore,
  riskReturn,
} from "@/lib/markets/math";
import type { MarketOpportunity, MarketSide } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function sideFacingOpportunity(
  market: MarketOpportunity,
  side: MarketSide,
): MarketOpportunity | null {
  if (market.model.probabilityBps === null) return null;

  const priceBps = side === "yes" ? market.yesAskBps : market.noAskBps;
  if (priceBps === null || priceBps <= 0 || priceBps >= 10_000) return null;

  const probabilityBps =
    side === "yes"
      ? market.model.probabilityBps
      : 10_000 - market.model.probabilityBps;
  const edgeBps = probabilityBps - priceBps;
  const roi = expectedRoi(probabilityBps, priceBps);
  const spreadBps =
    side === "yes"
      ? market.yesAskBps !== null && market.yesBidBps !== null
        ? market.yesAskBps - market.yesBidBps
        : market.spreadBps
      : market.noAskBps !== null && market.noBidBps !== null
        ? market.noAskBps - market.noBidBps
        : market.spreadBps;
  const ageSeconds = Math.max(
    0,
    (Date.now() - new Date(market.updatedAt).getTime()) / 1_000,
  );
  const score = lynervaScore({
    probabilityBps,
    edgeBps,
    priceBps,
    expectedRoi: roi,
    reliabilityBps: market.model.reliabilityBps,
    seasonHits: market.model.evidence.seasonHits,
    seasonGames: market.model.evidence.seasonGames,
    last10Hits: market.model.evidence.last10Hits,
    sampleSize: market.model.evidence.sampleSize,
    recommendedSide: side,
    liquidityCents: market.liquidityCents,
    volumeCents: market.volumeCents,
    spreadBps,
    ageSeconds,
  });

  return {
    ...market,
    recommendedSide: side,
    recommendedProbabilityBps: probabilityBps,
    executablePriceBps: priceBps,
    edgeBps,
    expectedRoi: roi,
    riskReturn: riskReturn(priceBps),
    spreadBps,
    opportunityScore: opportunityScore({
      edgeBps,
      priceBps,
      reliabilityBps: market.model.reliabilityBps,
      liquidityCents: market.liquidityCents,
      spreadBps,
      ageSeconds,
    }),
    lynervaScore: score?.score ?? null,
    scoreBreakdown: score?.breakdown ?? null,
  };
}

function expandOverUnderSides(market: MarketOpportunity) {
  const direction = market.canonical?.direction;
  if (direction !== "over" && direction !== "under") return [market];

  return (["yes", "no"] as const)
    .map((side) => sideFacingOpportunity(market, side))
    .filter((row): row is MarketOpportunity => row !== null);
}

export async function GET(request: Request) {
  const live = new URL(request.url).searchParams.get("live") === "1";
  // Pregame pages can rely on the five-minute background model refresh. Live
  // pages keep a much tighter refresh budget for score and pace context.
  const payload = await getMarketOpportunities(live ? 30_000 : 5 * 60_000);
  const etag = `W/"markets-${payload.fetchedAt}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  const rated = payload.opportunities.filter(
    (market) => market.model.probabilityBps !== null,
  );
  const priced = rated.filter(isPricedOpportunity);
  const opportunities = priced
    .flatMap(expandOverUnderSides)
    .filter(isPricedOpportunity)
    .map((market) => ({
      ...market,
      resolutionRules: null,
      model: {
        ...market.model,
        factors: [],
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
      displayedCount: Math.min(30, new Set(opportunities.map(groupKey)).size),
      fetchedAt: payload.fetchedAt,
    },
    {
      headers: {
        // Injury and lineup context can change minutes before kickoff. Do not
        // let an edge cache keep serving a pre-news model after the server has
        // already recomputed it.
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
