import { describe, expect, it } from "vitest";
import { buildCombination } from "./index";
import type { MarketOpportunity } from "@/lib/markets/types";

function opportunity(id: string, matchup: string, price: number, model: number): MarketOpportunity {
  return { platform: "kalshi", platformMarketId: id, platformOutcomeId: id, eventTitle: matchup, marketTitle: `${id} to win`, outcomeLabel: "Yes", resolutionRules: "Includes overtime", status: "open", isLive: false, yesBidBps: price - 100, yesAskBps: price, noBidBps: 10_000 - price - 100, noAskBps: 10_000 - price, lastPriceBps: price, liquidityCents: 100_000, volumeCents: 100_000, closesAt: "2026-10-01T00:00:00.000Z", updatedAt: new Date().toISOString(), sourceUrl: "https://example.com", canonical: { key: id, family: "moneyline", statistic: "game_winner", direction: "yes", threshold: null, subject: id, matchup, settlementDate: "2026-10-01", regulationOnly: false, parseConfidence: "high" }, model: { probabilityBps: model, reliabilityBps: 8_000, version: "test", evidence: { last5Hits: 3, last10Hits: 6, seasonHits: 8, seasonGames: 12, sampleSize: 12 }, factors: [] }, executablePriceBps: price, edgeBps: model - price, expectedRoi: (model - price) / price, riskReturn: (10_000 - price) / price, spreadBps: 100, opportunityScore: 1, freshness: "fresh", discrepancyBps: null, equivalentPlatform: null, arbitrage: null };
}

describe("combination builder", () => {
  it("finds a positive-edge combination inside the return target", () => {
    const result = buildCombination([
      opportunity("A", "KC-BUF", 5_000, 5_700),
      opportunity("B", "DAL-PHI", 5_000, 5_600),
    ], { minReturn: 3.5, maxReturn: 4.5, maxLegs: 3, platform: "either", live: "pregame", excludeSameGame: true });
    expect(result?.legs).toHaveLength(2);
    expect(result?.grossReturn).toBe(4);
    expect(result?.correlationWarning).toBe(false);
  });

  it("excludes same-game legs when correlation is unknown", () => {
    const result = buildCombination([
      opportunity("A", "KC-BUF", 5_000, 5_700),
      opportunity("B", "KC-BUF", 5_000, 5_600),
    ], { minReturn: 3.5, maxReturn: 4.5, maxLegs: 3, platform: "either", live: "pregame", excludeSameGame: true });
    expect(result).toBeNull();
  });
});
