import { z } from "zod";
import { marketFamilies, platforms, type MarketFilters, type MarketOpportunity } from "./types";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const numberParam = (value: string | string[] | undefined) => {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseMarketFilters(
  params: Record<string, string | string[] | undefined>,
): MarketFilters {
  const platform = z.enum(["all", ...platforms]).catch("all").parse(first(params.platform));
  const status = z.enum(["all", "pregame", "live"]).catch("all").parse(first(params.status));
  const family = z.enum(["all", ...marketFamilies]).catch("all").parse(first(params.type));
  const side = z.enum(["all", "yes", "no"]).catch("all").parse(first(params.side));
  const sort = z
    .enum([
      "best",
      "edge",
      "probability",
      "risk_return",
      "liquidity",
      "discrepancy",
      "game_time",
    ])
    .catch("best")
    .parse(first(params.sort));
  const priceMin = numberParam(params.priceMin);
  const priceMax = numberParam(params.priceMax);
  const modelMin = numberParam(params.modelMin);
  const edgeMin = numberParam(params.edgeMin);
  const liquidityMin = numberParam(params.liquidityMin);
  const hitRateMin = numberParam(params.hitRateMin);
  return {
    query: first(params.q)?.trim().slice(0, 100) ?? "",
    platform,
    status,
    family,
    side,
    minPriceBps: priceMin === null ? null : priceMin * 100,
    maxPriceBps: priceMax === null ? null : priceMax * 100,
    minModelBps: modelMin === null ? null : modelMin * 100,
    minEdgeBps: edgeMin === null ? null : edgeMin * 100,
    minLiquidityCents:
      liquidityMin === null ? null : Math.round(liquidityMin * 100),
    minHitRateBps: hitRateMin === null ? null : hitRateMin * 100,
    sort,
  };
}

function historicalHitRate(market: MarketOpportunity) {
  const { seasonHits, seasonGames } = market.model.evidence;
  if (seasonHits === null || !seasonGames) return null;
  const hits =
    market.recommendedSide === "no" ? seasonGames - seasonHits : seasonHits;
  return (hits / seasonGames) * 10_000;
}

export function filterAndSortMarkets(
  markets: MarketOpportunity[],
  filters: MarketFilters,
) {
  const query = filters.query.toLowerCase();
  const filtered = markets.filter((market) => {
    const price = market.executablePriceBps;
    const hitRate = historicalHitRate(market);
    if (query) {
      const haystack = `${market.eventTitle} ${market.marketTitle} ${market.outcomeLabel} ${market.canonical?.subject ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.platform !== "all" && market.platform !== filters.platform) return false;
    if (filters.status === "live" && !market.isLive) return false;
    if (filters.status === "pregame" && market.isLive) return false;
    if (filters.family !== "all" && market.canonical?.family !== filters.family) return false;
    if (filters.side !== "all" && market.recommendedSide !== filters.side) return false;
    if (filters.minPriceBps !== null && (price === null || price < filters.minPriceBps)) return false;
    if (filters.maxPriceBps !== null && (price === null || price > filters.maxPriceBps)) return false;
    if (filters.minModelBps !== null && (market.recommendedProbabilityBps === null || market.recommendedProbabilityBps < filters.minModelBps)) return false;
    if (filters.minEdgeBps !== null && (market.edgeBps === null || market.edgeBps < filters.minEdgeBps)) return false;
    if (filters.minLiquidityCents !== null && (market.liquidityCents === null || market.liquidityCents < filters.minLiquidityCents)) return false;
    if (filters.minHitRateBps !== null && (hitRate === null || hitRate < filters.minHitRateBps)) return false;
    return true;
  });

  const value = (market: MarketOpportunity) => {
    switch (filters.sort) {
      case "edge":
        return market.edgeBps ?? -Infinity;
      case "probability":
        return market.recommendedProbabilityBps ?? -Infinity;
      case "risk_return":
        return market.riskReturn ?? -Infinity;
      case "liquidity":
        return market.liquidityCents ?? -Infinity;
      case "discrepancy":
        return market.discrepancyBps ?? -Infinity;
      case "game_time":
        return market.closesAt ? -new Date(market.closesAt).getTime() : -Infinity;
      default:
        return market.arbitrage?.classification === "arbitrage"
          ? Number.MAX_SAFE_INTEGER
          : market.lynervaScore ?? -Infinity;
    }
  };
  return filtered.toSorted((a, b) => value(b) - value(a));
}
