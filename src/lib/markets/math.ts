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
