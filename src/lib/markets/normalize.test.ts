import { describe, expect, it } from "vitest";
import { canonicalKeyWithoutRules, normalizeMarket, settlementRulesMatch } from "./normalize";
import type { ProviderMarket } from "./types";

function contract(overrides: Partial<ProviderMarket> = {}): ProviderMarket {
  return { platform: "kalshi", platformMarketId: "one", platformOutcomeId: "yes", eventTitle: "Cincinnati Bengals at Baltimore Ravens", marketTitle: "Will Ja'Marr Chase record over 79.5 receiving yards?", outcomeLabel: "Yes", resolutionRules: "Includes overtime. Official NFL statistics are final.", status: "open", isLive: false, yesBidBps: 5_100, yesAskBps: 5_300, noBidBps: 4_600, noAskBps: 4_800, lastPriceBps: 5_200, liquidityCents: 50_000, volumeCents: 80_000, closesAt: "2026-10-12T20:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z", sourceUrl: "https://example.com", ...overrides };
}

describe("market normalization", () => {
  it("extracts a conservative player prop identity", () => {
    const normalized = normalizeMarket(contract());
    expect(normalized).toMatchObject({ family: "receiving_yards", statistic: "receiving_yards", direction: "over", threshold: 79.5, settlementDate: "2026-10-12", regulationOnly: false, parseConfidence: "high" });
    expect(normalized?.subject.toLowerCase()).toContain("jamarr chase");
  });

  it("does not pair semantically different thresholds", () => {
    const first = normalizeMarket(contract());
    const second = normalizeMarket(contract({ platform: "polymarket", marketTitle: "Will Ja'Marr Chase record over 89.5 receiving yards?" }));
    expect(first && second && canonicalKeyWithoutRules(first)).not.toBe(second && canonicalKeyWithoutRules(second));
  });

  it("does not call rule-unknown contracts identical", () => {
    const first = normalizeMarket(contract());
    const second = normalizeMarket(contract({ platform: "polymarket", resolutionRules: "Official statistics determine the outcome." }));
    expect(first && second && settlementRulesMatch(first, second)).toBe(false);
  });
});
