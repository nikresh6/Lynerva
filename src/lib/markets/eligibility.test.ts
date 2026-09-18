import { describe, expect, it } from "vitest";
import type { ProviderMarket } from "./types";
import {
  hasExecutableYesPrice,
  isProviderComboMarket,
  isSingleLegNflProviderMarket,
} from "./eligibility";

function market(overrides: Partial<ProviderMarket> = {}): ProviderMarket {
  return {
    platform: "kalshi",
    platformMarketId: "KXNFL-TEST",
    platformOutcomeId: "yes",
    eventTitle: "Buffalo Bills at Detroit Lions",
    marketTitle: "Will Josh Allen record over 249.5 passing yards?",
    outcomeLabel: "Yes",
    resolutionRules: "Official NFL statistics determine settlement.",
    status: "open",
    isLive: false,
    yesBidBps: 5_000,
    yesAskBps: 5_200,
    noBidBps: 4_700,
    noAskBps: 4_900,
    lastPriceBps: 5_100,
    liquidityCents: 100_000,
    volumeCents: 100_000,
    closesAt: "2026-09-18T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
    ...overrides,
  };
}

describe("market eligibility", () => {
  it("keeps a real NFL single-leg player prop", () => {
    expect(isSingleLegNflProviderMarket(market())).toBe(true);
  });

  it("does not treat the word no as New Orleans", () => {
    const baseball = market({
      platformMarketId: "KXMLB-TEST",
      eventTitle: "Miami baseball game",
      marketTitle: "no Josh Jung: 2+,no Miami wins by over 1.5 runs",
      resolutionRules: "Official league statistics determine settlement.",
    });
    expect(isSingleLegNflProviderMarket(baseball)).toBe(false);
  });

  it("rejects Kalshi cross-category multivariate contracts", () => {
    const combo = market({
      platformMarketId: "KXMVECROSSCATEGORY-S2026ABC",
      marketTitle:
        "yes Buffalo scores first TD,no Nick Morabito: 1+,yes Philadelphia wins by over 3.5 points",
    });
    expect(isProviderComboMarket(combo)).toBe(true);
    expect(isSingleLegNflProviderMarket(combo)).toBe(false);
  });

  it("rejects a zero-price row from top-pick eligibility", () => {
    expect(hasExecutableYesPrice(market({ yesAskBps: 0 }))).toBe(false);
  });
});
