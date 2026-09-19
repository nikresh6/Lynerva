import { clamp } from "@/lib/utils";
import type {
  ArbitrageLeg,
  ArbitrageOpportunity,
  ProviderMarket,
} from "./types";

export function riskReturn(priceBps: number) {
  if (priceBps <= 0 || priceBps >= 10_000) return null;
  return (10_000 - priceBps) / priceBps;
}

export function expectedValueBps(probabilityBps: number, priceBps: number) {
  return probabilityBps - priceBps;
}

export function expectedRoi(probabilityBps: number, priceBps: number) {
  if (priceBps <= 0) return null;
  return (probabilityBps - priceBps) / priceBps;
}

export function kalshiTakerFeeBps(priceBps: number, contracts = 1) {
  const price = clamp(priceBps / 10_000, 0, 1);
  const dollars = 0.07 * contracts * price * (1 - price);
  return Math.ceil(dollars * 100) * 100;
}

export function platformFeeBps(
  platform: "kalshi" | "polymarket",
  priceBps: number,
) {
  // Polymarket fees differ by market and are included only when the market
  // metadata exposes them. NFL discovery currently defaults to zero rather
  // than fabricating a fee. Kalshi's published general taker formula applies.
  return platform === "kalshi" ? kalshiTakerFeeBps(priceBps) : 0;
}

export function opportunityScore(input: {
  edgeBps: number;
  priceBps: number;
  reliabilityBps: number;
  liquidityCents: number | null;
  spreadBps: number | null;
  ageSeconds: number;
}) {
  const roi = expectedRoi(input.priceBps + input.edgeBps, input.priceBps) ?? 0;
  if (roi <= 0) return 0;
  const reliability = clamp(input.reliabilityBps / 10_000, 0.2, 1);
  const liquidity = input.liquidityCents
    ? clamp(Math.log10(Math.max(input.liquidityCents / 100, 1)) / 5, 0.2, 1)
    : 0.25;
  const spread = clamp(1 - (input.spreadBps ?? 1_000) / 2_500, 0.2, 1);
  const freshness = clamp(1 - input.ageSeconds / 3_600, 0.3, 1);
  return roi * reliability * liquidity * spread * freshness;
}


export function lynervaScore(input: {
  probabilityBps: number | null;
  edgeBps: number | null;
  priceBps: number | null;
  expectedRoi: number | null;
  reliabilityBps: number;
  seasonHits: number | null;
  seasonGames: number | null;
  last10Hits: number | null;
  sampleSize: number;
  recommendedSide: "yes" | "no" | null;
  liquidityCents: number | null;
  volumeCents: number | null;
  spreadBps: number | null;
  ageSeconds: number;
}) {
  if (
    input.probabilityBps === null ||
    input.edgeBps === null ||
    input.priceBps === null ||
    input.expectedRoi === null ||
    input.recommendedSide === null
  ) {
    return null;
  }

  // Publish a score from the two inputs that actually define the bet:
  // Lynerva's win probability and the executable price. Quote age, spread,
  // liquidity, and volume are execution/eligibility concerns, not reasons for
  // the score itself to drift on every refresh.
  //
  // Small one-cent market ticks are also deliberately treated as noise for the
  // public score. The exact market price and edge remain visible everywhere,
  // but the score works from 2pp buckets so it only reacts to a meaningful move.
  const SCORE_BUCKET_BPS = 200;
  const stableProbabilityBps =
    Math.round(input.probabilityBps / SCORE_BUCKET_BPS) * SCORE_BUCKET_BPS;
  const stablePriceBps =
    Math.round(input.priceBps / SCORE_BUCKET_BPS) * SCORE_BUCKET_BPS;
  const stableEdgeBps = stableProbabilityBps - stablePriceBps;
  const stableRoi =
    stablePriceBps > 0 ? stableEdgeBps / stablePriceBps : 0;

  const probability = clamp(stableProbabilityBps / 100, 0, 100);
  const value = clamp(
    (1 - Math.exp(-Math.max(stableRoi, 0) * 1.35)) * 100,
    0,
    100,
  );
  const edge = clamp((Math.max(stableEdgeBps, 0) / 2_000) * 100, 0, 100);
  const reliability = clamp(input.reliabilityBps / 100, 0, 100);

  let hitRate = probability;
  if (input.seasonHits !== null && input.seasonGames && input.seasonGames >= 5) {
    const hits =
      input.recommendedSide === "no"
        ? input.seasonGames - input.seasonHits
        : input.seasonHits;
    hitRate = clamp((hits / input.seasonGames) * 100, 0, 100);
  } else if (input.last10Hits !== null && input.sampleSize > 0) {
    const games = Math.min(10, input.sampleSize);
    const hits =
      input.recommendedSide === "no"
        ? games - input.last10Hits
        : input.last10Hits;
    hitRate = clamp((hits / games) * 100, 0, 100);
  }

  const dollars =
    Math.max(input.liquidityCents ?? 0, input.volumeCents ?? 0) / 100;
  const liquidity = dollars > 0
    ? clamp((Math.log10(dollars + 1) / 5) * 100, 0, 100)
    : 20;
  // Market microstructure should matter, but it should not be able to
  // whip a player score around because one bid disappears for a minute.
  // Spread quality therefore moves gradually and has a bounded floor.
  const spread = clamp(
    100 - ((input.spreadBps ?? 1_000) / 50),
    35,
    100,
  );
  const freshness = clamp(100 - input.ageSeconds / 36, 20, 100);
  const marketQuality =
    liquidity * 0.40 +
    spread * 0.35 +
    freshness * 0.25;

  // Current-season hit rate, reliability, and market quality remain visible
  // diagnostics and eligibility gates. They do not move the published score.
  // This keeps a pregame score identical when the model and meaningful market
  // price have not changed.
  const score =
    value * 0.54 +
    probability * 0.27 +
    edge * 0.19;

  return {
    score: Math.round(clamp(score, 0, 100)),
    breakdown: {
      value: Math.round(value),
      hitRate: Math.round(hitRate),
      probability: Math.round(probability),
      reliability: Math.round(reliability),
      edge: Math.round(edge),
      marketQuality: Math.round(marketQuality),
    },
  };
}

export function freshnessFrom(updatedAt: string, now = Date.now()) {
  const age = now - new Date(updatedAt).getTime();
  if (!Number.isFinite(age)) return "unavailable" as const;
  if (age <= 30_000) return "fresh" as const;
  if (age <= 5 * 60_000) return "delayed" as const;
  return "stale" as const;
}

function toLeg(
  market: ProviderMarket,
  side: "yes" | "no",
): ArbitrageLeg | null {
  const askBps = side === "yes" ? market.yesAskBps : market.noAskBps;
  if (askBps === null || askBps <= 0 || askBps >= 10_000) return null;
  return {
    platform: market.platform,
    side,
    askBps,
    feeBps: platformFeeBps(market.platform, askBps),
    listingId: `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? side}`,
  };
}

export function detectArbitrage(input: {
  canonicalKey: string;
  first: ProviderMarket;
  second: ProviderMarket;
  settlementRulesMatch: boolean;
}): ArbitrageOpportunity | null {
  if (input.first.platform === input.second.platform) return null;

  const combinations = [
    [toLeg(input.first, "yes"), toLeg(input.second, "no")],
    [toLeg(input.second, "yes"), toLeg(input.first, "no")],
  ] as const;

  let best: { yes: ArbitrageLeg; no: ArbitrageLeg; total: number } | null = null;
  for (const [yes, no] of combinations) {
    if (!yes || !no) continue;
    const total = yes.askBps + no.askBps + yes.feeBps + no.feeBps;
    if (!best || total < best.total) best = { yes, no, total };
  }
  if (!best) return null;

  const combinedCostBps = best.yes.askBps + best.no.askBps;
  const estimatedFeesBps = best.yes.feeBps + best.no.feeBps;
  const netProfitBps = 10_000 - combinedCostBps - estimatedFeesBps;
  const isExecutableArbitrage = input.settlementRulesMatch && netProfitBps > 0;
  const priceGap = Math.abs(
    (input.first.yesAskBps ?? input.first.lastPriceBps ?? 0) -
      (input.second.yesAskBps ?? input.second.lastPriceBps ?? 0),
  );
  if (!isExecutableArbitrage && priceGap < 500) return null;

  return {
    canonicalKey: input.canonicalKey,
    yesLeg: best.yes,
    noLeg: best.no,
    combinedCostBps,
    estimatedFeesBps,
    netProfitBps,
    netRoi:
      combinedCostBps + estimatedFeesBps > 0
        ? netProfitBps / (combinedCostBps + estimatedFeesBps)
        : 0,
    limitingLiquidityCents:
      input.first.liquidityCents === null || input.second.liquidityCents === null
        ? null
        : Math.min(input.first.liquidityCents, input.second.liquidityCents),
    classification: isExecutableArbitrage
      ? "arbitrage"
      : "price_dislocation",
    reason: isExecutableArbitrage
      ? "Opposite executable asks cover the same settlement outcome below $1 after estimated fees."
      : "Prices differ materially, but the settlement language is not identical enough to call this riskless.",
  };
}
