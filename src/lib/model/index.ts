import "server-only";

import { clamp } from "@/lib/utils";
import { findPublicPlayerHistory } from "@/lib/nfl/history";
import { getMatchupProjection } from "@/lib/nfl/team-history";
import type { NflScheduleGame } from "@/lib/nfl/schedule-match";
import type { LiveNflGame } from "@/lib/nfl/live";
import { getGameWeatherContext } from "@/lib/nfl/game-context";
import { weatherProbabilityAdjustment } from "./weather-adjustment";
import type {
  CanonicalMarket,
  HistoricalEvidence,
  ModelEstimate,
} from "@/lib/markets/types";

const MODEL_VERSION = "regular-season-v4";

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

export function calibratedLogisticProbability(input: {
  historicalHitRate: number;
  recentHitRate: number;
  recentPerformanceRatio: number;
  sampleSize: number;
}) {
  const linear =
    -1.18 +
    1.25 * input.historicalHitRate +
    0.95 * input.recentHitRate +
    0.42 * clamp(input.recentPerformanceRatio - 1, -1, 1) +
    0.018 * Math.min(input.sampleSize, 17);
  return 1 / (1 + Math.exp(-linear));
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
        : "League baseline used while regular-season team history loads.",
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
  const projectionTask = getMatchupProjection(
    scheduleGame.homeTeam,
    scheduleGame.awayTeam,
  );
  const projection = await Promise.race([
    projectionTask,
    new Promise<Awaited<ReturnType<typeof getMatchupProjection>>>((resolve) => {
      setTimeout(() => resolve(null), 450);
    }),
  ]);

  if (!projection) {
    const baseline = baselineGameProjection(scheduleGame, liveGame);
    return estimateGameFromDistribution(canonical, scheduleGame, {
      meanHomeMargin: baseline.meanHomeMargin,
      meanTotal: baseline.meanTotal,
      marginStdDev: baseline.marginStdDev,
      totalStdDev: baseline.totalStdDev,
      reliability: baseline.live ? 0.52 : 0.34,
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

    if (!history.playerName || values.length < 5) {
      return {
        probabilityBps: null,
        reliabilityBps: Math.round((values.length / 10) * 4_000),
        version: MODEL_VERSION,
        evidence: { ...emptyEvidence, sampleSize: values.length },
        factors: [
          values.length
            ? `Only ${values.length} comparable games are available; at least 5 are required.`
            : "No verified nflverse history matches this player prop.",
        ],
      };
    }

    const threshold = canonical.threshold;
    const last5 = values.slice(0, 5);
    const last10 = values.slice(0, 10);
    const historicalHits = hits(values, threshold, canonical.direction);
    const recentHits = hits(last5, threshold, canonical.direction);
    const average = last5.reduce((sum, value) => sum + value, 0) / last5.length;
    const currentSeason = new Date().getUTCFullYear();
    const seasonValues = sample
      .filter((row) => row.season === currentSeason)
      .map((row) => row.value);
    const seasonHitCount = hits(
      seasonValues,
      threshold,
      canonical.direction,
    );

    const baseProbability = calibratedLogisticProbability({
      historicalHitRate: historicalHits / values.length,
      recentHitRate: recentHits / last5.length,
      recentPerformanceRatio: threshold === 0 ? 1 : average / threshold,
      sampleSize: values.length,
    });
    const reliability = clamp(values.length / 17, 0, 1) * 0.78;
    const factors = [
      `${history.playerName} cleared this line in ${recentHits} of the last 5 games.`,
      `Regular-season sample: ${historicalHits} of ${values.length} at this threshold.`,
      `Last-5 average: ${average.toFixed(1)} versus a ${threshold} line.`,
    ];

    const weatherContext = await getGameWeatherContext(canonical);
    const weatherAdjustment = weatherProbabilityAdjustment({
      family: canonical.family,
      direction: canonical.direction,
      indoor: weatherContext?.indoor ?? false,
      weather: weatherContext?.weather ?? null,
    });

    if (weatherContext?.indoor) {
      factors.push("Indoor/closed-roof game: weather treated as neutral.");
    } else if (weatherContext?.weather) {
      const weather = weatherContext.weather;
      factors.push(
        `Forecast: ${Math.round(weather.temperatureF)}°F, ${Math.round(weather.windMph)} mph wind, ${Math.round(weather.precipitationProbability)}% precipitation.`,
      );
      if (weatherAdjustment !== 0) {
        factors.push(
          `Adverse-weather adjustment: ${weatherAdjustment > 0 ? "+" : ""}${(weatherAdjustment * 100).toFixed(1)} percentage points.`,
        );
      }
    }

    const probability = clamp(
      baseProbability + weatherAdjustment,
      0.03,
      0.97,
    );

    return {
      probabilityBps: Math.round(probability * 10_000),
      reliabilityBps: Math.round(reliability * 10_000),
      version: MODEL_VERSION,
      evidence: {
        last5Hits: recentHits,
        last10Hits: hits(last10, threshold, canonical.direction),
        seasonHits: seasonValues.length ? seasonHitCount : null,
        seasonGames: seasonValues.length || null,
        sampleSize: values.length,
      },
      factors,
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
