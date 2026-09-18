import type { MarketOpportunity, ProviderMarket } from "./types";
import { isNflText } from "./normalize";

function repeatedYesNoClauses(value: string) {
  return (value.match(/(?:^|,)\s*(?:yes|no)\b/gi) ?? []).length;
}

export function isProviderComboMarket(market: ProviderMarket) {
  const identity = `${market.platformMarketId} ${market.eventTitle} ${market.marketTitle}`;
  if (/\b(?:parlay|same game parlay|sgp|multivariate)\b/i.test(identity)) return true;
  if (/KXMVE|CROSSCATEGORY/i.test(identity)) return true;
  return repeatedYesNoClauses(market.marketTitle) >= 2;
}

export function hasExecutableYesPrice(market: ProviderMarket) {
  return (
    market.yesAskBps !== null &&
    market.yesAskBps > 0 &&
    market.yesAskBps < 10_000
  );
}

export function isSingleLegNflProviderMarket(market: ProviderMarket) {
  if (market.status !== "open") return false;
  if (isProviderComboMarket(market)) return false;
  const identity = `${market.eventTitle} ${market.marketTitle} ${market.resolutionRules ?? ""}`;
  if (
    /\b(?:1q|2q|3q|4q|1h|2h|first quarter|second quarter|third quarter|fourth quarter|first half|second half)\b/i.test(
      identity,
    )
  ) {
    return false;
  }
  if (
    !isNflText(
      market.eventTitle,
      market.marketTitle,
      market.outcomeLabel,
      market.resolutionRules,
    )
  ) {
    return false;
  }
  return true;
}

export function isPricedOpportunity(market: MarketOpportunity) {
  return (
    market.canonical !== null &&
    market.canonical.parseConfidence !== "low" &&
    market.recommendedSide !== null &&
    market.recommendedProbabilityBps !== null &&
    market.executablePriceBps !== null &&
    market.executablePriceBps > 0 &&
    market.executablePriceBps < 10_000 &&
    market.freshness !== "stale"
  );
}

export function isModelBackedOpportunity(market: MarketOpportunity) {
  return (
    isPricedOpportunity(market) &&
    market.edgeBps !== null &&
    market.edgeBps > 0
  );
}

export function isBuilderEligibleOpportunity(market: MarketOpportunity) {
  if (!isModelBackedOpportunity(market)) return false;
  if (
    market.executablePriceBps === null ||
    market.executablePriceBps < 500 ||
    market.executablePriceBps > 9_500
  ) {
    return false;
  }
  if (market.model.reliabilityBps < 4_500) return false;
  if ((market.edgeBps ?? 0) <= 0) return false;
  if (market.spreadBps !== null && market.spreadBps > 1_500) return false;
  return true;
}

export function isTopOpportunity(market: MarketOpportunity) {
  if (
    market.arbitrage?.classification === "arbitrage" &&
    hasExecutableYesPrice(market)
  ) {
    return true;
  }
  if (!isBuilderEligibleOpportunity(market)) return false;
  if ((market.edgeBps ?? 0) < 150) return false;
  return true;
}
