export const platforms = ["kalshi", "polymarket"] as const;
export type Platform = (typeof platforms)[number];

export const marketFamilies = [
  "moneyline",
  "spread",
  "game_total",
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
  "receptions",
  "longest_reception",
  "touchdowns",
  "other",
] as const;
export type MarketFamily = (typeof marketFamilies)[number];

export type MarketSide = "yes" | "no";
export type Direction = "over" | "under" | "yes" | "no";
export type Freshness = "fresh" | "delayed" | "stale" | "unavailable";

export interface ProviderMarket {
  platform: Platform;
  platformMarketId: string;
  platformOutcomeId: string | null;
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  resolutionRules: string | null;
  status: "open" | "closed" | "settled" | "unavailable";
  isLive: boolean;
  yesBidBps: number | null;
  yesAskBps: number | null;
  noBidBps: number | null;
  noAskBps: number | null;
  lastPriceBps: number | null;
  liquidityCents: number | null;
  volumeCents: number | null;
  closesAt: string | null;
  updatedAt: string;
  sourceUrl: string;
}

export interface CanonicalMarket {
  key: string;
  family: MarketFamily;
  statistic: string | null;
  direction: Direction;
  threshold: number | null;
  subject: string;
  matchup: string | null;
  settlementDate: string | null;
  regulationOnly: boolean | null;
  parseConfidence: "high" | "medium" | "low";
}

export interface HistoricalEvidence {
  last5Hits: number | null;
  last10Hits: number | null;
  seasonHits: number | null;
  seasonGames: number | null;
  sampleSize: number;
  recentValues?: number[];
}

export interface LynervaScoreBreakdown {
  value: number;
  hitRate: number;
  probability: number;
  reliability: number;
  edge: number;
  marketQuality: number;
}

export interface ModelEstimate {
  probabilityBps: number | null;
  reliabilityBps: number;
  version: string;
  evidence: HistoricalEvidence;
  factors: string[];
  components?: {
    consensusProjection: number | null;
    consensusProbabilityBps: number | null;
    statisticalProbabilityBps: number | null;
    contextAdjustmentBps: number;
    projectionSourceCount: number;
    projectionSources?: Array<{
      source: string;
      value: number;
    }>;
    gameProjectionSources?: Array<{
      source: string;
      probabilityBps: number;
    }>;
    currentSeasonTeamGames?: {
      subject: number;
      opponent: number;
    } | null;
    projectionSeason?: number | null;
    projectionWeek?: number | null;
    learnedSourceWeightWeek?: number | null;
    learnedCalibrationSample: number;
    learnedCalibrationActive: boolean;
    liveCurrentValue?: number | null;
    liveProjectedFinal?: number | null;
    liveRemainingFraction?: number | null;
    liveOvertimeProbabilityBps?: number | null;
  };
}



export interface ScoreMovement {
  delta: number;
  previousScore: number;
  currentScore: number;
  priceDeltaBps: number | null;
  probabilityDeltaBps: number | null;
  reliabilityDeltaBps: number;
  marketQualityDelta: number | null;
  projectionSourceCountDelta: number;
  consensusProjectionDelta: number | null;
  reason:
    | "market_price"
    | "model_probability"
    | "projection_sources"
    | "market_quality"
    | "mixed";
  detail: string;
}

export interface MarketOpportunity extends ProviderMarket {
  canonical: CanonicalMarket | null;
  model: ModelEstimate;
  recommendedSide: MarketSide | null;
  recommendedProbabilityBps: number | null;
  executablePriceBps: number | null;
  edgeBps: number | null;
  expectedRoi: number | null;
  riskReturn: number | null;
  spreadBps: number | null;
  opportunityScore: number | null;
  lynervaScore: number | null;
  scoreBreakdown: LynervaScoreBreakdown | null;
  freshness: Freshness;
  discrepancyBps: number | null;
  equivalentPlatform: Platform | null;
  arbitrage: ArbitrageOpportunity | null;
  scoreMovement?: ScoreMovement | null;
}

export interface ArbitrageLeg {
  platform: Platform;
  side: MarketSide;
  askBps: number;
  feeBps: number;
  listingId: string;
}

export interface ArbitrageOpportunity {
  canonicalKey: string;
  yesLeg: ArbitrageLeg;
  noLeg: ArbitrageLeg;
  combinedCostBps: number;
  estimatedFeesBps: number;
  netProfitBps: number;
  netRoi: number;
  limitingLiquidityCents: number | null;
  classification: "arbitrage" | "price_dislocation";
  reason: string;
}

export interface MarketFilters {
  query: string;
  platform: "all" | Platform;
  status: "all" | "pregame" | "live";
  family: "all" | MarketFamily;
  side: "all" | "yes" | "no";
  minPriceBps: number | null;
  maxPriceBps: number | null;
  minModelBps: number | null;
  minEdgeBps: number | null;
  minLiquidityCents: number | null;
  minHitRateBps: number | null;
  sort:
    | "best"
    | "edge"
    | "probability"
    | "risk_return"
    | "liquidity"
    | "discrepancy"
    | "game_time";
}

export interface ProviderResult {
  provider: Platform;
  markets: ProviderMarket[];
  fetchedAt: string;
  error: string | null;
}
