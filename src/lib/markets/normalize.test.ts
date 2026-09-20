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

  it("normalizes each Kalshi team moneyline as its own game-winner outcome", () => {
    const normalized = normalizeMarket(
      contract({
        platformMarketId: "KXNFLGAME-26SEP20DALCHI-CHI",
        eventTitle: "KXNFLGAME-26SEP20DALCHI",
        marketTitle: "Will the Chicago Bears beat the Dallas Cowboys?",
        outcomeLabel: "Chicago Bears",
        resolutionRules:
          "Resolves Yes if the Chicago Bears win the Dallas Cowboys at Chicago Bears NFL game.",
        closesAt: "2026-09-21T03:30:00.000Z",
      }),
    );

    expect(normalized).toMatchObject({
      family: "moneyline",
      statistic: "game_winner",
      direction: "yes",
      threshold: null,
      subject: "CHI",
      matchup: "CHI-DAL",
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


  it("uses the team named in a wins-by spread, not the first ticker team", () => {
    const normalized = normalizeMarket(
      contract({
        platformMarketId: "KXNFLSPREAD-26SEP20GBNYJ-NYJ14",
        eventTitle: "KXNFLSPREAD-26SEP20GBNYJ",
        marketTitle: "New York J wins by over 14.5 points?",
        resolutionRules: "Resolves Yes if the New York Jets win by more than 14.5 points.",
        closesAt: "2026-09-22T00:00:00.000Z",
      }),
    );
    expect(normalized).toMatchObject({
      family: "spread",
      subject: "NYJ",
      threshold: 14.5,
      matchup: "GB-NYJ",
      settlementDate: "2026-09-22",
    });
  });

  it("parses Polymarket O/U totals with the real threshold", () => {
    const normalized = normalizeMarket(
      contract({
        platform: "polymarket",
        platformMarketId: "buf-det-total-70-5",
        eventTitle: "Lions vs. Bills",
        marketTitle: "Lions vs. Bills: O/U 70.5",
        outcomeLabel: "Over",
        resolutionRules:
          "Sports market type: totals. Resolves Over if Detroit and Buffalo combine for more than 70.5 points.",
        closesAt: "2026-09-18T00:15:00.000Z",
      }),
    );
    expect(normalized).toMatchObject({
      family: "game_total",
      statistic: "game_points",
      direction: "over",
      threshold: 70.5,
      matchup: "BUF-DET",
      parseConfidence: "high",
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


describe("additional weekly player prop normalization", () => {
  it("recognizes longest reception markets before generic receptions", () => {
    const normalized = normalizeMarket(
      contract({
        marketTitle: "Will Ja'Marr Chase record over 27.5 longest reception?",
        platformMarketId: "KXNFLLONGREC-26SEP20CINHOU-JCHASE1-28",
      }),
    );
    expect(normalized).toMatchObject({
      family: "longest_reception",
      statistic: "longest_reception",
      direction: "over",
      threshold: 27.5,
      subject: "Ja'Marr Chase",
    });
  });

  it("cleans the stat suffix from compact longest-reception subjects", () => {
    const normalized = normalizeMarket(
      contract({
        marketTitle: "Malik Nabers: longest reception 21.5",
        outcomeLabel: "Over 21.5",
        platformMarketId: "KXNFLLONGREC-26SEP20LARNYG-MNABERS-22",
        eventTitle: "Los Angeles Rams at New York Giants",
      }),
    );

    expect(normalized).toMatchObject({
      family: "longest_reception",
      threshold: 21.5,
      subject: "Malik Nabers",
    });
  });

  it("recognizes quarterback interception props", () => {
    const normalized = normalizeMarket(
      contract({
        marketTitle: "Patrick Mahomes: Over 0.5 interceptions",
        outcomeLabel: "Over 0.5",
        platformMarketId: "KXNFLPASSINT-26SEP20INDKC-PMAHOMES-1",
        eventTitle: "Indianapolis Colts at Kansas City Chiefs",
        resolutionRules:
          "Resolves Yes if Patrick Mahomes throws at least 1 interception.",
      }),
    );

    expect(normalized).toMatchObject({
      family: "passing_interceptions",
      statistic: "passing_interceptions",
      direction: "over",
      threshold: 0.5,
      subject: "Patrick Mahomes",
      matchup: "IND-KC",
    });
  });

  it("splits rushing and receiving touchdown props from anytime touchdowns", () => {
    const rushing = normalizeMarket(
      contract({
        marketTitle: "Bijan Robinson: 1+ rushing touchdowns",
        platformMarketId: "KXNFLRUSHTD-26SEP20ATLCAR-BROBINSON-1",
        eventTitle: "Atlanta Falcons at Carolina Panthers",
        resolutionRules:
          "Resolves Yes if Bijan Robinson scores at least 1 rushing touchdown.",
      }),
    );
    const receiving = normalizeMarket(
      contract({
        marketTitle: "Ja'Marr Chase: 1+ receiving touchdowns",
        platformMarketId: "KXNFLRECTD-26SEP20CINHOU-JCHASE-1",
        resolutionRules:
          "Resolves Yes if Ja'Marr Chase scores at least 1 receiving touchdown.",
      }),
    );
    const anytime = normalizeMarket(
      contract({
        marketTitle: "Ja'Marr Chase: 1+ touchdowns",
        platformMarketId: "KXNFLSCORE-26SEP20CINHOU-JCHASE-1",
        resolutionRules:
          "Resolves Yes if Ja'Marr Chase scores at least 1 touchdown by rushing or receiving.",
      }),
    );

    expect(rushing).toMatchObject({
      family: "touchdowns",
      statistic: "touchdowns",
    });
    expect(receiving).toMatchObject({
      family: "touchdowns",
      statistic: "touchdowns",
    });
    expect(anytime).toMatchObject({
      family: "touchdowns",
      statistic: "touchdowns",
    });
  });

  it("keeps rushing yards as a separate searchable family", () => {
    const normalized = normalizeMarket(
      contract({
        marketTitle: "Will Ja'Marr Chase record over 9.5 rushing yards?",
        platformMarketId: "KXNFLRUSHYDS-26SEP20CINHOU-JCHASE1-10",
      }),
    );
    expect(normalized).toMatchObject({
      family: "rushing_yards",
      statistic: "rushing_yards",
      direction: "over",
      threshold: 9.5,
      subject: "Ja'Marr Chase",
    });
  });
});
