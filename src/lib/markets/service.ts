import "server-only";

import { fetchKalshiNflMarkets } from "@/lib/kalshi";
import { fetchPolymarketNflMarkets } from "@/lib/polymarket";
import { estimateMarket } from "@/lib/model";
import {
  findEligibleScheduleGame,
  loadNflSchedule,
} from "@/lib/nfl/schedule";
import { marketFixtures } from "./fixtures";
import { isSingleLegNflProviderMarket } from "./eligibility";
import {
  canonicalKeyWithoutRules,
  normalizeMarket,
  settlementRulesMatch,
} from "./normalize";
import {
  detectArbitrage,
  expectedRoi,
  freshnessFrom,
  opportunityScore,
  riskReturn,
} from "./math";
import type {
  MarketOpportunity,
  ProviderMarket,
  ProviderResult,
} from "./types";

export interface MarketsPayload {
  opportunities: MarketOpportunity[];
  providers: ProviderResult[];
  fetchedAt: string;
  fixtureMode: boolean;
}

export async function getMarketOpportunities(): Promise<MarketsPayload> {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.USE_MARKET_FIXTURES === "true";
  const providers = fixtureMode
    ? [
        {
          provider: "kalshi" as const,
          markets: marketFixtures.filter((market) => market.platform === "kalshi"),
          fetchedAt: new Date().toISOString(),
          error: null,
        },
        {
          provider: "polymarket" as const,
          markets: marketFixtures.filter(
            (market) => market.platform === "polymarket",
          ),
          fetchedAt: new Date().toISOString(),
          error: null,
        },
      ]
    : await Promise.all([fetchKalshiNflMarkets(), fetchPolymarketNflMarkets()]);
  const coarseProviders = providers.map((provider) => ({
    ...provider,
    markets: provider.markets.filter(isSingleLegNflProviderMarket),
  }));
  const candidates = coarseProviders
    .flatMap((provider) => provider.markets)
    .map((market) => ({
      market,
      canonical: normalizeMarket(market),
    }));

  let normalized = candidates;
  let scheduleError: string | null = null;
  if (!fixtureMode) {
    try {
      const schedule = await loadNflSchedule();
      normalized = candidates.filter(
        (item) =>
          item.canonical !== null &&
          findEligibleScheduleGame(item.canonical, schedule) !== null,
      );
    } catch (error) {
      scheduleError =
        error instanceof Error ? error.message : "NFL schedule validation failed";
      console.error("NFL schedule validation failed", error);
      normalized = [];
    }
  }

  const accepted = new Set(
    normalized.map((item) => marketKey(item.market)),
  );
  const cleanProviders = coarseProviders.map((provider) => ({
    ...provider,
    error: scheduleError
      ? [provider.error, scheduleError].filter(Boolean).join(" · ")
      : provider.error,
    markets: provider.markets.filter((market) =>
      accepted.has(marketKey(market)),
    ),
  }));
  const raw = normalized.map((item) => item.market);
  const modelCache = new Map<
    string,
    Awaited<ReturnType<typeof estimateMarket>>
  >();
  const getModel = async (item: (typeof normalized)[number]) => {
    const key = item.canonical?.key ?? `unmatched:${item.market.platformMarketId}`;
    const cached = modelCache.get(key);
    if (cached) return cached;
    const estimate = await estimateMarket(item.canonical);
    modelCache.set(key, estimate);
    return estimate;
  };
  const models = await Promise.all(normalized.map(getModel));
  const groups = new Map<string, number[]>();
  normalized.forEach((item, index) => {
    if (!item.canonical) return;
    const key = canonicalKeyWithoutRules(item.canonical);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const comparison = new Map<
    number,
    Pick<MarketOpportunity, "discrepancyBps" | "equivalentPlatform" | "arbitrage">
  >();
  for (const indexes of groups.values()) {
    const kalshiIndex = indexes.find(
      (index) => raw[index]?.platform === "kalshi",
    );
    const polymarketIndex = indexes.find(
      (index) => raw[index]?.platform === "polymarket",
    );
    if (kalshiIndex === undefined || polymarketIndex === undefined) continue;
    const first = normalized[kalshiIndex];
    const second = normalized[polymarketIndex];
    if (!first?.canonical || !second?.canonical) continue;
    const firstPrice = raw[kalshiIndex]?.yesAskBps;
    const secondPrice = raw[polymarketIndex]?.yesAskBps;
    const discrepancy =
      firstPrice !== null && secondPrice !== null
        ? Math.abs(firstPrice - secondPrice)
        : null;
    const arbitrage = detectArbitrage({
      canonicalKey: canonicalKeyWithoutRules(first.canonical),
      first: first.market,
      second: second.market,
      settlementRulesMatch: settlementRulesMatch(
        first.canonical,
        second.canonical,
      ),
    });
    comparison.set(kalshiIndex, {
      discrepancyBps: discrepancy,
      equivalentPlatform: "polymarket",
      arbitrage,
    });
    comparison.set(polymarketIndex, {
      discrepancyBps: discrepancy,
      equivalentPlatform: "kalshi",
      arbitrage,
    });
  }

  const now = Date.now();
  const opportunities = normalized.map((item, index): MarketOpportunity => {
    const model = models[index];
    const market = item.market;
    const executablePriceBps = market.yesAskBps;
    const edgeBps =
      model.probabilityBps !== null && executablePriceBps !== null
        ? model.probabilityBps - executablePriceBps
        : null;
    const spreadBps =
      market.yesAskBps !== null && market.yesBidBps !== null
        ? market.yesAskBps - market.yesBidBps
        : null;
    const ageSeconds = Math.max(
      0,
      (now - new Date(market.updatedAt).getTime()) / 1_000,
    );
    const peer = comparison.get(index);
    return {
      ...market,
      canonical: item.canonical,
      model,
      executablePriceBps,
      edgeBps,
      expectedRoi:
        model.probabilityBps !== null && executablePriceBps !== null
          ? expectedRoi(model.probabilityBps, executablePriceBps)
          : null,
      riskReturn:
        executablePriceBps === null ? null : riskReturn(executablePriceBps),
      spreadBps,
      opportunityScore:
        edgeBps !== null && executablePriceBps !== null
          ? opportunityScore({
              edgeBps,
              priceBps: executablePriceBps,
              reliabilityBps: model.reliabilityBps,
              liquidityCents: market.liquidityCents,
              spreadBps,
              ageSeconds,
            })
          : null,
      freshness: freshnessFrom(market.updatedAt, now),
      discrepancyBps: peer?.discrepancyBps ?? null,
      equivalentPlatform: peer?.equivalentPlatform ?? null,
      arbitrage: peer?.arbitrage ?? null,
    };
  });
  return {
    opportunities,
    providers: cleanProviders,
    fetchedAt: new Date().toISOString(),
    fixtureMode,
  };
}

export function marketKey(market: ProviderMarket) {
  return `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
}
