import { describe, expect, it } from "vitest";
import type { MarketFamily, MarketOpportunity } from "./types";
import {
  marketMatchesSearchIntent,
  parseMarketSearchQuery,
} from "./search";

function market(input: {
  id: string;
  family: MarketFamily;
  subject: string;
  matchup: string;
  threshold?: number | null;
  direction?: "over" | "under" | "yes" | "no";
  title?: string;
  recommendedSide?: "yes" | "no";
}): MarketOpportunity {
  const probability = 6200;
  const price = 5500;
  return {
    platform: "kalshi",
    platformMarketId: input.id,
    platformOutcomeId: input.id,
    eventTitle: input.matchup,
    marketTitle:
      input.title ??
      `${input.subject} ${input.family.replaceAll("_", " ")}`,
    outcomeLabel: "Yes",
    resolutionRules: "Official NFL statistics",
    status: "open",
    isLive: false,
    yesBidBps: price - 100,
    yesAskBps: price,
    noBidBps: 10_000 - price - 100,
    noAskBps: 10_000 - price,
    lastPriceBps: price,
    liquidityCents: 100_000,
    volumeCents: 100_000,
    closesAt: "2026-09-21T20:00:00.000Z",
    updatedAt: "2026-09-20T20:00:00.000Z",
    sourceUrl: "https://example.com",
    canonical: {
      key: input.id,
      family: input.family,
      statistic: input.family,
      direction: input.direction ?? (input.family === "moneyline" ? "yes" : "over"),
      threshold: input.threshold ?? null,
      subject: input.subject,
      matchup: input.matchup,
      settlementDate: "2026-09-21",
      regulationOnly: false,
      parseConfidence: "high",
    },
    model: {
      probabilityBps: probability,
      reliabilityBps: 8_000,
      version: "test",
      evidence: {
        last5Hits: 4,
        last10Hits: 7,
        seasonHits: 9,
        seasonGames: 12,
        sampleSize: 12,
      },
      factors: [],
    },
    recommendedSide: input.recommendedSide ?? "yes",
    recommendedProbabilityBps: probability,
    executablePriceBps: price,
    edgeBps: probability - price,
    expectedRoi: 0.1,
    riskReturn: 0.8,
    spreadBps: 100,
    opportunityScore: 70,
    lynervaScore: 75,
    scoreBreakdown: {
      value: 75,
      hitRate: 75,
      probability: 75,
      reliability: 80,
      edge: 75,
      marketQuality: 75,
    },
    freshness: "fresh",
    discrepancyBps: null,
    equivalentPlatform: null,
    arbitrage: null,
  };
}

describe("parseMarketSearchQuery", () => {
  it("understands a team abbreviation plus moneyline intent", () => {
    const intent = parseMarketSearchQuery("kc moneyline");
    expect(intent.teams.map((team) => team.code)).toEqual(["KC"]);
    expect(intent.families).toEqual(["moneyline"]);
    expect(intent.terms).toEqual([]);
  });

  it("understands player prop shorthand and a threshold", () => {
    const intent = parseMarketSearchQuery("Mahomes over 250 pass yds");
    expect(intent.families).toEqual(["passing_yards"]);
    expect(intent.direction).toBe("over");
    expect(intent.threshold).toBe(250);
    expect(intent.terms).toEqual(["mahomes"]);
  });

  it("understands common team nicknames", () => {
    const intent = parseMarketSearchQuery("pats ml");
    expect(intent.teams.map((team) => team.code)).toEqual(["NE"]);
    expect(intent.families).toEqual(["moneyline"]);
  });

  it("understands two-team matchup searches", () => {
    const intent = parseMarketSearchQuery("chiefs vs bills");
    expect(intent.teams.map((team) => team.code).toSorted()).toEqual([
      "BUF",
      "KC",
    ]);
  });
});

describe("marketMatchesSearchIntent", () => {
  const chiefs = market({
    id: "kc-ml",
    family: "moneyline",
    subject: "KC",
    matchup: "BUF-KC",
    title: "Kansas City Chiefs moneyline",
  });
  const bills = market({
    id: "buf-ml",
    family: "moneyline",
    subject: "BUF",
    matchup: "BUF-KC",
    title: "Buffalo Bills moneyline",
  });
  const mahomes = market({
    id: "mahomes-pass",
    family: "passing_yards",
    subject: "Patrick Mahomes",
    matchup: "BUF-KC",
    threshold: 249.5,
    title: "Patrick Mahomes passing yards",
  });

  it("returns the requested team's moneyline, not just any market in the game", () => {
    const intent = parseMarketSearchQuery("kc moneyline");
    expect(marketMatchesSearchIntent(chiefs, intent)).toBe(true);
    expect(marketMatchesSearchIntent(bills, intent)).toBe(false);
  });

  it("matches natural player/stat/side/number searches", () => {
    const intent = parseMarketSearchQuery("Mahomes over 250 pass yds");
    expect(marketMatchesSearchIntent(mahomes, intent)).toBe(true);
  });

  it("tolerates a one-character player-name typo", () => {
    const intent = parseMarketSearchQuery("Mahome passing yards");
    expect(marketMatchesSearchIntent(mahomes, intent)).toBe(true);
  });

  it("matches both outcomes when the user searches a matchup", () => {
    const intent = parseMarketSearchQuery("chiefs bills moneyline");
    expect(marketMatchesSearchIntent(chiefs, intent)).toBe(true);
    expect(marketMatchesSearchIntent(bills, intent)).toBe(true);
  });
});
