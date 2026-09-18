import "server-only";

import { clamp } from "@/lib/utils";
import { findPublicPlayerHistory } from "@/lib/nfl/history";
import { getMatchupProjection } from "@/lib/nfl/team-history";
import type { NflScheduleGame } from "@/lib/nfl/schedule-match";
import type { LiveNflGame } from "@/lib/nfl/live";
import { empiricalPlayerProbability } from "./player-probability";
import { getExternalProjectionConsensus } from "./external-projections";
import { selfCalibrateProbability } from "./self-learning";
import type {
  CanonicalMarket,
  HistoricalEvidence,
  ModelEstimate,
} from "@/lib/markets/types";

const MODEL_VERSION = "hybrid-consensus-context-v2";

const emptyEvidence: HistoricalEvidence = {
  last5Hits: null,
  last10Hits: null,
  seasonHits: null,
  seasonGames: null,
  sampleSize: 0,
};

function isHit(value: number, threshold: number, direction: string) {
  return direction === "under" ? value < threshold : value >= threshold;
}

function hits(values: number[], threshold: number, direction: string) {
  return values.reduce(
    (count, value) => count + (isHit(value, threshold, direction) ? 1 : 0),
    0,
  );
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number, mean: number, stdDev: number) {
  return 0.5 * (1 + erf((value - mean) / (stdDev * Math.sqrt(2))));
}

function remainingGameFraction(game: LiveNflGame | null | undefined) {
  if (!game || game.state !== "in") return 1;
  if (game.period > 4) return 0.04;
  const [minutesRaw, secondsRaw] = game.clock.split(":");
  const clockSeconds =
    Number(minutesRaw || 0) * 60 + Number(secondsRaw || 0);
  const elapsed = Math.max(
    0,
    (Math.max(game.period, 1) - 1) * 900 + (900 - clockSeconds),
  );
  return clamp((3600 - elapsed) / 3600, 0.02, 1);
}

function baselineGameProjection(
  scheduleGame: NflScheduleGame,
  liveGame?: LiveNflGame | null,
) {
  const live = liveGame?.state === "in" ? liveGame : null;
  const remaining = remainingGameFraction(live);
  const currentHome = live?.home.score ?? 0;
  const currentAway = live?.away.score ?? 0;
  const currentMargin = currentHome - currentAway;
  const currentTotal = currentHome + currentAway;

  return {
    live,
    remaining,
    meanHomeMargin: live ? currentMargin + 1.5 * remaining : 1.5,
    meanTotal: live ? currentTotal + 44.5 * remaining : 44.5,
    marginStdDev: Math.max(2.5, 13.5 * Math.sqrt(remaining)),
    totalStdDev: Math.max(3, 13 * Math.sqrt(remaining)),
    factors: [
      live
        ? `Live baseline: ${live.away.team} ${live.away.score}, ${live.home.team} ${live.home.score}, ${live.status} ${live.clock}.`
        : "Current-season team sample is still too small, so this uses a low-confidence league baseline.",
    ],
  };
}

function estimateGameFromDistribution(
  canonical: CanonicalMarket,
  scheduleGame: NflScheduleGame,
  input: {
    meanHomeMargin: number;
    meanTotal: number;
    marginStdDev: number;
    totalStdDev: number;
    reliability: number;
    factors: string[];
  },
): ModelEstimate {
  let probability: number | null = null;
  const factors = [...input.factors];

  if (canonical.family === "moneyline") {
    const subjectIsHome = canonical.subject === scheduleGame.homeTeam;
    const subjectIsAway = canonical.subject === scheduleGame.awayTeam;
    if (!subjectIsHome && !subjectIsAway) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: emptyEvidence,
        factors: ["Could not identify the team represented by this moneyline."],
      };
    }
    const mean = subjectIsHome ? input.meanHomeMargin : -input.meanHomeMargin;
    probability = 1 - normalCdf(0, mean, input.marginStdDev);
    factors.push(
      `Projected ${canonical.subject} scoring margin: ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}.`,
    );
  } else if (canonical.family === "spread" && canonical.threshold !== null) {
    const subjectIsHome = canonical.subject === scheduleGame.homeTeam;
    const subjectIsAway = canonical.subject === scheduleGame.awayTeam;
    if (!subjectIsHome && !subjectIsAway) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: emptyEvidence,
        factors: ["Could not identify the team represented by this spread."],
      };
    }
    const mean = subjectIsHome ? input.meanHomeMargin : -input.meanHomeMargin;
    probability = 1 - normalCdf(canonical.threshold, mean, input.marginStdDev);
    factors.push(
      `Projected ${canonical.subject} margin: ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} versus ${canonical.threshold >= 0 ? "+" : ""}${canonical.threshold.toFixed(1)}.`,
    );
  } else if (canonical.family === "game_total" && canonical.threshold !== null) {
    const over = 1 - normalCdf(canonical.threshold, input.meanTotal, input.totalStdDev);
    probability = canonical.direction === "under" ? 1 - over : over;
    factors.push(
      `Projected final total: ${input.meanTotal.toFixed(1)} versus ${canonical.threshold.toFixed(1)}.`,
    );
  }

  return {
    probabilityBps:
      probability === null
        ? null
        : Math.round(clamp(probability, 0.02, 0.98) * 10_000),
    reliabilityBps: Math.round(input.reliability * 10_000),
    version: MODEL_VERSION,
    evidence: emptyEvidence,
    factors:
      probability === null
        ? ["This game market could not be priced reliably."]
        : factors,
  };
}

async function estimateGameMarket(
  canonical: CanonicalMarket,
  scheduleGame: NflScheduleGame,
  liveGame?: LiveNflGame | null,
): Promise<ModelEstimate> {
  const projection = getMatchupProjection(
    scheduleGame.homeTeam,
    scheduleGame.awayTeam,
    scheduleGame.season,
    scheduleGame.week ?? 1,
  );

  if (!projection) {
    const baseline = baselineGameProjection(scheduleGame, liveGame);
    return estimateGameFromDistribution(canonical, scheduleGame, {
      meanHomeMargin: baseline.meanHomeMargin,
      meanTotal: baseline.meanTotal,
      marginStdDev: baseline.marginStdDev,
      totalStdDev: baseline.totalStdDev,
      reliability: baseline.live ? 0.42 : 0.28,
      factors: baseline.factors,
    });
  }

  const live = liveGame?.state === "in" ? liveGame : null;
  const remaining = remainingGameFraction(live);
  const currentHome = live?.home.score ?? 0;
  const currentAway = live?.away.score ?? 0;
  const currentMargin = currentHome - currentAway;
  const currentTotal = currentHome + currentAway;

  const meanHomeMargin = live
    ? currentMargin + projection.projectedHomeMargin * remaining
    : projection.projectedHomeMargin;
  const meanTotal = live
    ? currentTotal + projection.projectedTotal * remaining
    : projection.projectedTotal;
  const marginStdDev = Math.max(
    2.5,
    projection.marginStdDev * Math.sqrt(remaining),
  );
  const totalStdDev = Math.max(
    3,
    projection.totalStdDev * Math.sqrt(remaining),
  );

  let probability: number | null = null;
  const factors = [
    `Regular-season-only sample: ${projection.home.games} ${scheduleGame.homeTeam} games and ${projection.away.games} ${scheduleGame.awayTeam} games.`,
    `Pregame projection: ${projection.homePoints.toFixed(1)}-${projection.awayPoints.toFixed(1)} (${projection.projectedTotal.toFixed(1)} total).`,
  ];

  if (live) {
    factors.push(
      `Live state: ${live.away.team} ${live.away.score}, ${live.home.team} ${live.home.score}, ${live.status} ${live.clock}.`,
    );
  }

  if (canonical.family === "moneyline") {
    const subjectIsHome = canonical.subject === scheduleGame.homeTeam;
    const subjectIsAway = canonical.subject === scheduleGame.awayTeam;
    if (!subjectIsHome && !subjectIsAway) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: emptyEvidence,
        factors: ["Could not identify the team represented by this moneyline."],
      };
    }
    const subjectMarginMean = subjectIsHome ? meanHomeMargin : -meanHomeMargin;
    probability = 1 - normalCdf(0, subjectMarginMean, marginStdDev);
    factors.push(
      `Projected ${canonical.subject} scoring margin: ${subjectMarginMean >= 0 ? "+" : ""}${subjectMarginMean.toFixed(1)}.`,
    );
  } else if (canonical.family === "spread" && canonical.threshold !== null) {
    const subjectIsHome = canonical.subject === scheduleGame.homeTeam;
    const subjectIsAway = canonical.subject === scheduleGame.awayTeam;
    if (!subjectIsHome && !subjectIsAway) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: emptyEvidence,
        factors: ["Could not identify the team represented by this spread."],
      };
    }
    const subjectMarginMean = subjectIsHome ? meanHomeMargin : -meanHomeMargin;
    probability =
      1 -
      normalCdf(
        canonical.threshold,
        subjectMarginMean,
        marginStdDev,
      );
    factors.push(
      `Model margin for ${canonical.subject}: ${subjectMarginMean >= 0 ? "+" : ""}${subjectMarginMean.toFixed(1)} versus a ${canonical.threshold >= 0 ? "+" : ""}${canonical.threshold.toFixed(1)} requirement.`,
    );
  } else if (
    canonical.family === "game_total" &&
    canonical.threshold !== null
  ) {
    const overProbability =
      1 - normalCdf(canonical.threshold, meanTotal, totalStdDev);
    probability =
      canonical.direction === "under" ? 1 - overProbability : overProbability;
    factors.push(
      `Projected final total: ${meanTotal.toFixed(1)} versus ${canonical.threshold.toFixed(1)}.`,
    );
  }

  if (probability === null) {
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["This game market could not be priced reliably."],
    };
  }

  const sampleSize = Math.min(
    projection.home.games,
    projection.away.games,
  );
  const reliability = clamp(
    0.52 + sampleSize / 100 + (live ? 0.08 : 0),
    0.5,
    0.84,
  );

  return {
    probabilityBps: Math.round(clamp(probability, 0.02, 0.98) * 10_000),
    reliabilityBps: Math.round(reliability * 10_000),
    version: MODEL_VERSION,
    evidence: {
      ...emptyEvidence,
      sampleSize,
    },
    factors,
  };
}

export async function estimateMarket(
  canonical: CanonicalMarket | null,
  scheduleGame?: NflScheduleGame | null,
  liveGame?: LiveNflGame | null,
): Promise<ModelEstimate> {
  if (!canonical) {
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["This market could not be normalized."],
    };
  }

  if (
    ["moneyline", "spread", "game_total"].includes(canonical.family) &&
    scheduleGame
  ) {
    return estimateGameMarket(canonical, scheduleGame, liveGame);
  }

  if (
    canonical.threshold === null ||
    canonical.statistic === null
  ) {
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["This market type does not yet have a model-backed probability."],
    };
  }

  try {
    const history = await findPublicPlayerHistory(
      canonical.subject,
      canonical.statistic,
    );
    const sample = history.values.slice(0, 20);
    const values = sample.map((row) => row.value);
    const threshold = canonical.threshold;

    const external = await getExternalProjectionConsensus(
      canonical,
      scheduleGame?.week ?? null,
    );

    const distributionStdDev: Partial<Record<CanonicalMarket["family"], number>> = {
      passing_yards: 58,
      passing_touchdowns: 1.05,
      rushing_yards: 26,
      receiving_yards: 29,
      receptions: 2.25,
      touchdowns: 0.62,
    };

    let consensusProbability: number | null = null;
    if (external.projection !== null) {
      const stdDev = distributionStdDev[canonical.family] ?? Math.max(1, threshold * 0.35);
      const overProbability = 1 - normalCdf(threshold, external.projection, stdDev);
      consensusProbability =
        canonical.direction === "under" ? 1 - overProbability : overProbability;
    }

    let statisticalProbability: number | null = null;
    let recentHits: number | null = null;
    let seasonHitCount: number | null = null;

    if (values.length >= 4) {
      const last5 = values.slice(0, 5);
      const historicalHits = hits(values, threshold, canonical.direction);
      recentHits = hits(last5, threshold, canonical.direction);
      const average = last5.reduce((sum, value) => sum + value, 0) / last5.length;
      seasonHitCount = historicalHits;
      statisticalProbability = empiricalPlayerProbability({
        historicalHitRate: historicalHits / values.length,
        recentHitRate: recentHits / last5.length,
        recentPerformanceRatio: threshold === 0 ? 1 : average / threshold,
        sampleSize: values.length,
      });
    }

    if (consensusProbability === null && statisticalProbability === null) {
      return {
        probabilityBps: null,
        reliabilityBps: 0,
        version: MODEL_VERSION,
        evidence: {
          ...emptyEvidence,
          sampleSize: values.length,
          recentValues: values.slice(0, 10),
        },
        factors: [
          "No independent projection source is currently available for this prop.",
          values.length < 4
            ? `Only ${values.length} current-season games are available; the statistical model stays off until four.`
            : "The four-game statistical model could not produce a usable estimate.",
        ],
      };
    }

    let probability = consensusProbability ?? statisticalProbability ?? 0.5;
    if (consensusProbability !== null && statisticalProbability !== null) {
      const statisticalWeight = clamp(0.30 + (values.length - 4) * 0.05, 0.30, 0.55);
      probability =
        consensusProbability * (1 - statisticalWeight) +
        statisticalProbability * statisticalWeight;
    }

    let contextAdjustment = 0;
    const gameProjection =
      scheduleGame
        ? getMatchupProjection(
            scheduleGame.homeTeam,
            scheduleGame.awayTeam,
            scheduleGame.season,
            scheduleGame.week ?? 1,
          )
        : null;
    if (gameProjection) {
      const environment =
        gameProjection.projectedTotal >= 49
          ? 0.012
          : gameProjection.projectedTotal <= 39
            ? -0.012
            : 0;
      const environmentSensitive = [
        "passing_yards",
        "passing_touchdowns",
        "receiving_yards",
        "receptions",
        "touchdowns",
      ].includes(canonical.family);
      if (environmentSensitive && environment !== 0) {
        contextAdjustment +=
          canonical.direction === "under" ? -environment : environment;
      }
    }

    probability = clamp(probability + contextAdjustment, 0.02, 0.98);
    const calibrated = await selfCalibrateProbability(probability);
    probability = calibrated.probability;

    const sourceCount = external.points.length;
    const dispersionPenalty =
      external.dispersion === null || external.projection === null
        ? 0
        : clamp(
            external.dispersion / Math.max(Math.abs(external.projection), 1),
            0,
            0.25,
          );
    const sourceReliability =
      sourceCount >= 2 ? 0.66 : sourceCount === 1 ? 0.52 : 0.38;
    const historyBoost =
      values.length >= 4 ? clamp(values.length / 40, 0.08, 0.22) : 0;
    const reliability = clamp(
      sourceReliability + historyBoost - dispersionPenalty,
      0.30,
      0.88,
    );

    const factors = [
      external.projection !== null
        ? `Independent projection consensus: ${external.projection.toFixed(1)} from ${sourceCount} source${sourceCount === 1 ? "" : "s"} (${external.points.map((point) => point.source).join(", ")}).`
        : "Independent projection consensus unavailable.",
      values.length >= 4
        ? `Four-game statistical model active using ${values.length} current-season regular-season games.`
        : `Statistical model locked until four current-season games; ${values.length} available now.`,
    ];
    if (gameProjection) {
      factors.push(
        `Game context retained: projected scoring environment ${gameProjection.projectedTotal.toFixed(1)} points from current regular-season team data.`,
      );
    }
    if (contextAdjustment !== 0) {
      factors.push(
        `Context layer adjusted probability by ${(contextAdjustment * 100).toFixed(1)} percentage points.`,
      );
    }
    if (calibrated.learned) {
      factors.push(
        `Self-calibration active using ${calibrated.sampleSize} settled predictions in this probability bucket.`,
      );
    }

    return {
      probabilityBps: Math.round(probability * 10_000),
      reliabilityBps: Math.round(reliability * 10_000),
      version: MODEL_VERSION,
      evidence: {
        last5Hits: recentHits,
        last10Hits:
          values.length >= 4
            ? hits(values.slice(0, 10), threshold, canonical.direction)
            : null,
        seasonHits: seasonHitCount,
        seasonGames: values.length || null,
        sampleSize: values.length,
        recentValues: values.slice(0, 10),
      },
      factors,
      components: {
        consensusProjection: external.projection,
        consensusProbabilityBps:
          consensusProbability === null
            ? null
            : Math.round(consensusProbability * 10_000),
        statisticalProbabilityBps:
          statisticalProbability === null
            ? null
            : Math.round(statisticalProbability * 10_000),
        contextAdjustmentBps: Math.round(contextAdjustment * 10_000),
        projectionSourceCount: sourceCount,
        learnedCalibrationSample: calibrated.sampleSize,
        learnedCalibrationActive: calibrated.learned,
      },
    };
  } catch (error) {
    console.error("Model estimate failed", error);
    return {
      probabilityBps: null,
      reliabilityBps: 0,
      version: MODEL_VERSION,
      evidence: emptyEvidence,
      factors: ["Historical evidence is temporarily unavailable."],
    };
  }
}
