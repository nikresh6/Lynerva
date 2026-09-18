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
    expect(normalized?.subject.toLowerCase()).toContain("ja'marr chase");
  });

  it("parses compact Kalshi player props using ticker and settlement rules", () => {
    const normalized = normalizeMarket(
      contract({
        platformMarketId: "KXNFLPASSYDS-26SEP17DETBUF-JALLEN250",
        eventTitle: "KXNFLPASSYDS-26SEP17DETBUF",
        marketTitle: "Josh Allen: 250+",
        outcomeLabel: "Yes",
        resolutionRules:
          "Resolves Yes if Josh Allen records at least 250 passing yards in the Detroit Lions at Buffalo Bills NFL game.",
        closesAt: "2026-09-18T00:15:00.000Z",
      }),
    );
    expect(normalized).toMatchObject({
      family: "passing_yards",
      statistic: "passing_yards",
      direction: "over",
      threshold: 250,
      subject: "Josh Allen",
      matchup: "BUF-DET",
      settlementDate: "2026-09-18",
      parseConfidence: "high",
    });
  });

  it("does not treat an NFL season-long receiving-yards future as a game prop", () => {
    const normalized = normalizeMarket(
      contract({
        platform: "polymarket",
        platformMarketId: "nico-season",
        eventTitle: "Pro Football: Nico Collins 2026-27 Regular Season Receiving Yards",
        marketTitle: "Nico Collins 1274.5+ receiving yards",
        resolutionRules:
          "This market resolves using Nico Collins's full 2026-27 NFL regular season receiving-yard total.",
        closesAt: "2027-01-12T00:00:00.000Z",
      }),
    );
    expect(normalized?.family).toBe("receiving_yards");
    expect(normalized?.matchup).toBeNull();
  });

  it("treats wins-by wording as a positive margin requirement", () => {
    const normalized = normalizeMarket(
      contract({
        platformMarketId: "KXNFLSPREAD-26SEP17DETBUF-DET14",
        eventTitle: "Detroit Lions at Buffalo Bills",
        marketTitle: "Detroit wins by over 14.5 points?",
        resolutionRules:
          "Resolves Yes if Detroit wins the game by more than 14.5 points.",
        closesAt: "2026-09-18T00:15:00.000Z",
      }),
    );
    expect(normalized).toMatchObject({
      family: "spread",
      subject: "DET",
      threshold: 14.5,
      direction: "over",
      matchup: "BUF-DET",
    });
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
