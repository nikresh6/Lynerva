import { describe, expect, it } from "vitest";
import {
  calculatedManualTrackerProfit,
  manualTrackerProfit,
  normalizeManualTrackerBet,
  type ManualTrackerBet,
} from "./manual";

function bet(overrides: Partial<ManualTrackerBet> = {}): ManualTrackerBet {
  return {
    id: "bet-1",
    date: "2026-09-20",
    description: "Two-leg parlay",
    platform: "kalshi",
    stake: 10,
    payout: 40,
    manualProfitOverride: null,
    status: "win",
    marketId: null,
    side: null,
    entryPriceBps: null,
    entryModelProbabilityBps: null,
    isLive: false,
    isParlay: true,
    legs: ["A", "B"],
    legMarketIds: [],
    legSides: [],
    legEntryPriceBps: [],
    legEntryModelProbabilityBps: [],
    toWin: 30,
    decimalOdds: 4,
    ...overrides,
  };
}

describe("manual tracker realized P/L", () => {
  it("keeps the automatic calculation available for audit", () => {
    expect(calculatedManualTrackerProfit(bet())).toBe(30);
  });

  it("uses a manual override for both straights and parlays", () => {
    expect(manualTrackerProfit(bet({ manualProfitOverride: 18.75 }))).toBe(
      18.75,
    );
    expect(
      manualTrackerProfit(
        bet({ isParlay: false, manualProfitOverride: -4.25 }),
      ),
    ).toBe(-4.25);
  });

  it("normalizes older saved bets without an override", () => {
    const normalized = normalizeManualTrackerBet({
      ...bet(),
      manualProfitOverride: undefined,
    });
    expect(normalized?.manualProfitOverride).toBeNull();
  });
});
