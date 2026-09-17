import { describe, expect, it } from "vitest";
import { detectArbitrage, expectedRoi, expectedValueBps, kalshiTakerFeeBps, riskReturn } from "./math";
import type { ProviderMarket } from "./types";

function market(platform: "kalshi" | "polymarket", yesAskBps: number, noAskBps: number): ProviderMarket {
  return { platform, platformMarketId: `${platform}-1`, platformOutcomeId: `${platform}-yes`, eventTitle: "Chiefs at Bills", marketTitle: "Will the Chiefs win?", outcomeLabel: "Yes", resolutionRules: "Includes overtime", status: "open", isLive: false, yesBidBps: yesAskBps - 100, yesAskBps, noBidBps: noAskBps - 100, noAskBps, lastPriceBps: yesAskBps, liquidityCents: 10_000, volumeCents: 20_000, closesAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", sourceUrl: "https://example.com" };
}

describe("market math", () => {
  it("calculates transparent risk:return and expected value", () => {
    expect(riskReturn(4_000)).toBe(1.5);
    expect(expectedValueBps(6_300, 5_400)).toBe(900);
    expect(expectedRoi(6_300, 5_400)).toBeCloseTo(1 / 6, 5);
  });

  it("rounds the published Kalshi taker fee up to the next cent", () => {
    expect(kalshiTakerFeeBps(5_000, 1)).toBe(200);
  });

  it("includes fees before calling a cross-platform pair arbitrage", () => {
    const result = detectArbitrage({ canonicalKey: "same", first: market("kalshi", 4_300, 5_800), second: market("polymarket", 4_700, 5_200), settlementRulesMatch: true });
    expect(result?.combinedCostBps).toBe(9_500);
    expect(result?.estimatedFeesBps).toBeGreaterThan(0);
    expect(result?.classification).toBe("arbitrage");
    expect(result?.netProfitBps).toBeGreaterThan(0);
  });

  it("downgrades unmatched settlement language to a dislocation", () => {
    const result = detectArbitrage({ canonicalKey: "similar", first: market("kalshi", 4_000, 5_900), second: market("polymarket", 5_600, 4_300), settlementRulesMatch: false });
    expect(result?.classification).toBe("price_dislocation");
  });
});
