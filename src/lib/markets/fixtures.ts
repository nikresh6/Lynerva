import type { ProviderMarket } from "./types";

// These records are available only when USE_MARKET_FIXTURES=true. They are
// intentionally isolated from production data paths and never silently used.
const now = new Date().toISOString();
const close = new Date(Date.now() + 86_400_000).toISOString();

export const marketFixtures: ProviderMarket[] = [
  {
    platform: "kalshi",
    platformMarketId: "FIXTURE-KC-BUF-KC",
    platformOutcomeId: "FIXTURE-KC-BUF-KC",
    eventTitle: "Kansas City Chiefs at Buffalo Bills",
    marketTitle: "Will the Kansas City Chiefs win?",
    outcomeLabel: "Kansas City Chiefs",
    resolutionRules: "Includes overtime. Resolves Yes if Kansas City wins.",
    status: "open",
    isLive: false,
    yesBidBps: 4_900,
    yesAskBps: 5_100,
    noBidBps: 4_800,
    noAskBps: 5_000,
    lastPriceBps: 5_000,
    liquidityCents: 860_000,
    volumeCents: 2_400_000,
    closesAt: close,
    updatedAt: now,
    sourceUrl: "#",
  },
  {
    platform: "polymarket",
    platformMarketId: "fixture-kc-buf",
    platformOutcomeId: "fixture-kc-yes",
    eventTitle: "Kansas City Chiefs at Buffalo Bills",
    marketTitle: "Will the Kansas City Chiefs win?",
    outcomeLabel: "Yes",
    resolutionRules: "Includes overtime. Resolves Yes if Kansas City wins.",
    status: "open",
    isLive: false,
    yesBidBps: 5_500,
    yesAskBps: 5_600,
    noBidBps: 4_300,
    noAskBps: 4_400,
    lastPriceBps: 5_500,
    liquidityCents: 1_280_000,
    volumeCents: 4_100_000,
    closesAt: close,
    updatedAt: now,
    sourceUrl: "#",
  },
];
