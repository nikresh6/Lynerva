import { describe, expect, it } from "vitest";
import { detectArbitrage, expectedRoi, expectedValueBps, kalshiTakerFeeBps, lynervaScore, riskReturn } from "./math";
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

  it("does not let a transient bid-ask spread create a large score jump", () => {
    const base = {
      probabilityBps: 6_500,
      edgeBps: 1_500,
      priceBps: 5_000,
      expectedRoi: 0.3,
      reliabilityBps: 7_500,
      seasonHits: null,
      seasonGames: null,
      last10Hits: null,
      sampleSize: 0,
      recommendedSide: "yes" as const,
      liquidityCents: 20_000,
      volumeCents: 50_000,
      ageSeconds: 5,
    };

    const tight = lynervaScore({ ...base, spreadBps: 100 });
    const wide = lynervaScore({ ...base, spreadBps: 2_000 });

    expect(tight).not.toBeNull();
    expect(wide).not.toBeNull();
    expect(Math.abs((tight?.score ?? 0) - (wide?.score ?? 0))).toBeLessThanOrEqual(2);
  });


  it("keeps Lynerva Score identical across refresh-only market noise", () => {
    const base = {
      probabilityBps: 6_800,
      edgeBps: 1_800,
      priceBps: 5_000,
      expectedRoi: 0.36,
      reliabilityBps: 7_800,
      seasonHits: null,
      seasonGames: null,
      last10Hits: null,
      sampleSize: 0,
      recommendedSide: "yes" as const,
      liquidityCents: 25_000,
      volumeCents: 80_000,
      spreadBps: 100,
      ageSeconds: 5,
    };

    const first = lynervaScore(base);
    const noisyRefresh = lynervaScore({
      ...base,
      reliabilityBps: 5_100,
      liquidityCents: 500,
      volumeCents: 500_000,
      spreadBps: 1_400,
      ageSeconds: 600,
    });

    expect(first?.score).toBe(noisyRefresh?.score);
  });

  it("ignores a one-point market tick in the published score", () => {
    const common = {
      probabilityBps: 6_800,
      edgeBps: 1_800,
      expectedRoi: 0.36,
      reliabilityBps: 7_800,
      seasonHits: null,
      seasonGames: null,
      last10Hits: null,
      sampleSize: 0,
      recommendedSide: "yes" as const,
      liquidityCents: 25_000,
      volumeCents: 80_000,
      spreadBps: 100,
      ageSeconds: 5,
    };

    const first = lynervaScore({
      ...common,
      priceBps: 5_000,
    });
    const onePointTick = lynervaScore({
      ...common,
      priceBps: 5_100,
      edgeBps: 1_700,
      expectedRoi: 1_700 / 5_100,
    });

    expect(first?.score).toBe(onePointTick?.score);
  });

  it("changes score after a meaningful market move", () => {
    const common = {
      probabilityBps: 6_800,
      reliabilityBps: 7_800,
      seasonHits: null,
      seasonGames: null,
      last10Hits: null,
      sampleSize: 0,
      recommendedSide: "yes" as const,
      liquidityCents: 25_000,
      volumeCents: 80_000,
      spreadBps: 100,
      ageSeconds: 5,
    };

    const first = lynervaScore({
      ...common,
      priceBps: 5_000,
      edgeBps: 1_800,
      expectedRoi: 0.36,
    });
    const moved = lynervaScore({
      ...common,
      priceBps: 5_400,
      edgeBps: 1_400,
      expectedRoi: 1_400 / 5_400,
    });

    expect(first?.score).not.toBe(moved?.score);
  });

});
