import { recommendedPredictionPerspective } from "./prediction-perspective";

// Selection is intentionally pure so pregame quality gates can be unit tested.
// Do not use settlement outcomes or future information to rank candidates.
const EARLIEST_SCORECARD_AT = new Date("2026-09-21T16:10:00.000Z").getTime();
const MAX_SIGNAL_AGE_MS = 8 * 60 * 60_000;
const MIN_EDGE_BPS = 500;
const MIN_RELIABILITY_BPS = 6500;
const MIN_MODEL_PROBABILITY_BPS = 6000;
const MIN_PLAYER_SOURCE_COUNT = 5;
const MIN_PLAYER_GAME_SAMPLE = 4;
const MIN_PUBLIC_SCORE = 70;
const MAX_QUOTE_MOVEMENT_BPS = 350;

type FeatureBag = Record<string, number | string | boolean | null>;
type ScorecardGame = { kickoffAt: Date; bucket: string | null };
type BucketRule = { id: string; count: number };

export type ReliableScorecardCandidate = {
  id: string;
  normalizedMarketId: string;
  predictedAt: Date;
  features: FeatureBag;
  eventTitle: string;
  family: string;
  predictedProbabilityBps: number;
  executablePriceBps: number;
  edgeBps: number;
  reliabilityBps: number;
  sampleSize: number;
  marketStatus: string;
  platform: string;
  isLiveMarket: boolean;
  quoteFetchedAt: Date;
  yesAskBps: number | null;
  noAskBps: number | null;
};

function canonicalTeamCode(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function matchupKey(value: string) {
  return value.split("-").map(canonicalTeamCode).filter(Boolean).sort().join("-");
}

function publicScore(candidate: ReliableScorecardCandidate) {
  const score = candidate.features.lynervaScore;
  return typeof score === "number" && Number.isFinite(score) ? score : -1;
}

function isQualityCandidate(candidate: ReliableScorecardCandidate, cutoff: Date) {
  const signalAge = cutoff.getTime() - candidate.predictedAt.getTime();
  const quoteAge = cutoff.getTime() - candidate.quoteFetchedAt.getTime();
  if (signalAge < 0 || signalAge > MAX_SIGNAL_AGE_MS) return false;
  if (quoteAge < -60_000 || quoteAge > MAX_SIGNAL_AGE_MS) return false;
  if (candidate.marketStatus !== "open" || candidate.platform !== "kalshi" || candidate.isLiveMarket) return false;
  if (publicScore(candidate) < MIN_PUBLIC_SCORE) return false;
  if (candidate.edgeBps < MIN_EDGE_BPS) return false;
  if (candidate.reliabilityBps < MIN_RELIABILITY_BPS) return false;
  if (candidate.executablePriceBps < 1000 || candidate.executablePriceBps > 9000) return false;

  const perspective = recommendedPredictionPerspective(candidate);
  if (perspective.probabilityBps < MIN_MODEL_PROBABILITY_BPS) return false;
  const currentAsk = perspective.side === "yes" ? candidate.yesAskBps : candidate.noAskBps;
  if (currentAsk === null || currentAsk <= 0 || currentAsk >= 10_000) return false;
  if (Math.abs(currentAsk - candidate.executablePriceBps) > MAX_QUOTE_MOVEMENT_BPS) return false;

  if (!["moneyline", "spread", "game_total"].includes(candidate.family)) {
    if (candidate.sampleSize < MIN_PLAYER_GAME_SAMPLE) return false;
    if (
      typeof candidate.features.projectionSourceCount !== "number" ||
      candidate.features.projectionSourceCount < MIN_PLAYER_SOURCE_COUNT
    ) return false;
  }
  return true;
}

export function selectScorecardBucketLeaders<T extends ReliableScorecardCandidate>(
  candidates: T[],
  gameByMatchup: Map<string, ScorecardGame>,
  rule: BucketRule,
  cutoff: Date,
): T[] {
  // Crucial: first take the latest pre-cutoff prediction, including negative
  // edges, then apply quality gates. Filtering first could resurrect an older
  // seemingly profitable prediction after the model has withdrawn it.
  const latestByMarket = new Map<string, T>();
  for (const candidate of [...candidates].sort(
    (a, b) => b.predictedAt.getTime() - a.predictedAt.getTime(),
  )) {
    const time = candidate.predictedAt.getTime();
    if (time > cutoff.getTime() || time < EARLIEST_SCORECARD_AT) continue;
    const matchup =
      typeof candidate.features.matchup === "string"
        ? matchupKey(candidate.features.matchup)
        : "";
    const game = gameByMatchup.get(matchup);
    if (!game || game.bucket !== rule.id || time >= game.kickoffAt.getTime()) continue;
    if (!latestByMarket.has(candidate.normalizedMarketId)) {
      latestByMarket.set(candidate.normalizedMarketId, candidate);
    }
  }

  const eligible = [...latestByMarket.values()]
    .filter((candidate) => isQualityCandidate(candidate, cutoff))
    .sort(
      (a, b) => publicScore(b) - publicScore(a) || b.edgeBps - a.edgeBps,
    );

  const selected: T[] = [];
  const selectedSubjects = new Set<string>();
  const picksPerGame = new Map<string, number>();
  for (const candidate of eligible) {
    const matchup =
      typeof candidate.features.matchup === "string"
        ? matchupKey(candidate.features.matchup)
        : matchupKey(candidate.eventTitle);
    const subject =
      typeof candidate.features.subject === "string"
        ? candidate.features.subject.trim().toLowerCase()
        : "";
    const subjectKey = subject ? `${matchup}:${subject}` : candidate.normalizedMarketId;
    if (selectedSubjects.has(subjectKey)) continue;
    // No more than two predictions on any one game within a bucket.
    if ((picksPerGame.get(matchup) ?? 0) >= 2) continue;
    selected.push(candidate);
    selectedSubjects.add(subjectKey);
    picksPerGame.set(matchup, (picksPerGame.get(matchup) ?? 0) + 1);
    if (selected.length >= rule.count) break;
  }
  return selected;
}
