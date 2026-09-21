import "server-only";

import { clamp } from "@/lib/utils";
import { findPublicPlayerHistory } from "@/lib/nfl/history";
import { getMatchupProjection } from "@/lib/nfl/team-history";
import { getCurrentSeasonMatchupProjection } from "@/lib/nfl/current-season-team";
import type { NflScheduleGame } from "@/lib/nfl/schedule-match";
import type { LiveNflGame } from "@/lib/nfl/live";
import { getLivePlayerStat } from "@/lib/nfl/live-player-stats";
import { canPublishPlayerProbability, empiricalPlayerProbability, poissonAtLeastProbability } from "./player-probability";
import { conditionalLivePlayerProbability } from "./live-player-probability";
import { getExternalProjectionConsensus } from "./external-projections";
import { getEspnGameProbability } from "./game-projections";
import { selfCalibrateProbability } from "./self-learning";
import { weatherProbabilityAdjustment } from "./weather-adjustment";
import { getGameWeather } from "@/lib/weather";
import type {
  CanonicalMarket,
  HistoricalEvidence,
  ModelEstimate,
} from "@/lib/markets/types";

const MODEL_VERSION = "hybrid-consensus-learning-v7";

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

function sampleStdDev(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Number.isFinite(variance) ? Math.sqrt(Math.max(variance, 0)) : null;
}

function adaptivePlayerStdDev(prior: number, values: number[]) {
  const observed = sampleStdDev(values);
  if (observed === null || observed <= 0 || values.length < 4) return prior;

  // Start from a family-level volatility prior, then gradually let the
  // player's own regular-season variance matter as the sample grows.
  const historyWeight = clamp((values.length - 3) / 18, 0.12, 0.58);
  const blended = prior * (1 - historyWeight) + observed * historyWeight;
  return clamp(blended, prior * 0.65, prior * 1.75);
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
  const currentWeek = scheduleGame.week ?? 1;
  const [projection, espn] = await Promise.all([
    getCurrentSeasonMatchupProjection(
      scheduleGame.homeTeam,
      scheduleGame.awayTeam,
      scheduleGame.season,
      currentWeek,
    ),
    liveGame?.id ? getEspnGameProbability(liveGame.id) : Promise.resolve(null),
  ]);

  const live = liveGame?.state === "in" ? liveGame : null;
  const remaining = remainingGameFraction(live);
  const currentHome = live?.home.score ?? 0;
  const currentAway = live?.away.score ?? 0;
  const currentMargin = currentHome - currentAway;
  const currentTotal = currentHome + currentAway;

  const baseline = baselineGameProjection(scheduleGame, liveGame);
  const projectedHomeMargin =
    projection?.projectedHomeMargin ?? baseline.meanHomeMargin;
  const projectedTotal = projection?.projectedTotal ?? baseline.meanTotal;
  const baseMarginStdDev =
    projection?.marginStdDev ?? baseline.marginStdDev;
  const baseTotalStdDev =
    projection?.totalStdDev ?? baseline.totalStdDev;

  const meanHomeMargin = live
    ? currentMargin + projectedHomeMargin * remaining
    : projectedHomeMargin;
  const meanTotal = live
    ? currentTotal + projectedTotal * remaining
    : projectedTotal;
  const marginStdDev = Math.max(
    2.5,
    baseMarginStdDev * Math.sqrt(remaining),
  );
  const totalStdDev = Math.max(
    3,
    baseTotalStdDev * Math.sqrt(remaining),
  );

  let probability: number | null = null;
  let statisticalProbability: number | null = null;
  let subjectProfile:
    | NonNullable<typeof projection>["home"]
    | NonNullable<typeof projection>["away"]
    | null = null;
  let opponentProfile:
    | NonNullable<typeof projection>["home"]
    | NonNullable<typeof projection>["away"]
    | null = null;
  const gameProjectionSources: Array<{
    source: string;
    probabilityBps: number;
  }> = [];

  const factors = projection
    ? [
        `2026 regular-season team data only: ${projection.home.games} ${scheduleGame.homeTeam} game${projection.home.games === 1 ? "" : "s"} and ${projection.away.games} ${scheduleGame.awayTeam} game${projection.away.games === 1 ? "" : "s"}.`,
        `Current-season scoring model: ${projection.homePoints.toFixed(1)}-${projection.awayPoints.toFixed(1)} (${projection.projectedTotal.toFixed(1)} total).`,
      ]
    : [
        "Current-season team sample is incomplete, so the internal game model is using a low-confidence league baseline.",
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
    statisticalProbability =
      1 - normalCdf(0, subjectMarginMean, marginStdDev);

    gameProjectionSources.push({
      source: projection
        ? "nflverse_current_season_scoring"
        : "current_season_league_baseline",
      probabilityBps: Math.round(statisticalProbability * 10_000),
    });

    const weighted: Array<{ probability: number; weight: number }> = [
      { probability: statisticalProbability, weight: live ? 0.50 : 0.50 },
    ];

    if (projection) {
      subjectProfile = subjectIsHome ? projection.home : projection.away;
      opponentProfile = subjectIsHome ? projection.away : projection.home;
      const subjectWinRate =
        (subjectProfile.wins + subjectProfile.ties * 0.5 + 1.5) /
        (subjectProfile.games + 3);
      const opponentWinRate =
        (opponentProfile.wins + opponentProfile.ties * 0.5 + 1.5) /
        (opponentProfile.games + 3);
      const subjectHomeAdjustment = subjectIsHome ? 0.025 : -0.025;
      const recordProbability = clamp(
        0.5 +
          (subjectWinRate - opponentWinRate) * 0.42 +
          subjectHomeAdjustment,
        0.18,
        0.82,
      );
      weighted.push({
        probability: recordProbability,
        weight: live ? 0.08 : 0.15,
      });
      gameProjectionSources.push({
        source: "nflverse_current_season_record",
        probabilityBps: Math.round(recordProbability * 10_000),
      });
    }

    const espnPregameSubject =
      espn?.pregameHomeProbability === null ||
      espn?.pregameHomeProbability === undefined
        ? null
        : subjectIsHome
          ? espn.pregameHomeProbability
          : 1 - espn.pregameHomeProbability;
    const espnLiveSubject =
      espn?.liveHomeProbability === null ||
      espn?.liveHomeProbability === undefined
        ? null
        : subjectIsHome
          ? espn.liveHomeProbability
          : 1 - espn.liveHomeProbability;

    if (live && espnLiveSubject !== null) {
      weighted.push({ probability: espnLiveSubject, weight: 0.42 });
      gameProjectionSources.push({
        source: "espn_live_win_probability",
        probabilityBps: Math.round(espnLiveSubject * 10_000),
      });
      factors.push(
        `ESPN live win model: ${(espnLiveSubject * 100).toFixed(1)}% for ${canonical.subject}.`,
      );
    } else if (espnPregameSubject !== null) {
      weighted.push({
        probability: espnPregameSubject,
        weight: live ? 0.12 : 0.35,
      });
      gameProjectionSources.push({
        source: "espn_fpi",
        probabilityBps: Math.round(espnPregameSubject * 10_000),
      });
      factors.push(
        `ESPN pregame projection: ${(espnPregameSubject * 100).toFixed(1)}% for ${canonical.subject}.`,
      );
    }

    const totalWeight = weighted.reduce((sum, point) => sum + point.weight, 0);
    probability =
      weighted.reduce(
        (sum, point) => sum + point.probability * point.weight,
        0,
      ) / totalWeight;

    factors.push(
      `Lynerva current-season margin model: ${(statisticalProbability * 100).toFixed(1)}% for ${canonical.subject} (${subjectMarginMean >= 0 ? "+" : ""}${subjectMarginMean.toFixed(1)} projected margin).`,
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
  } else if (
    canonical.family === "game_total" &&
    canonical.threshold !== null
  ) {
    const overProbability =
      1 - normalCdf(canonical.threshold, meanTotal, totalStdDev);
    probability =
      canonical.direction === "under" ? 1 - overProbability : overProbability;
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

  const calibrated = await selfCalibrateProbability(
    clamp(probability, 0.01, 0.99),
    canonical.family,
  );
  probability = calibrated.probability;

  const sampleSize = projection
    ? Math.min(projection.home.games, projection.away.games)
    : 0;
  const independentSourceBoost =
    gameProjectionSources.some((point) => point.source === "espn_fpi") ||
    gameProjectionSources.some(
      (point) => point.source === "espn_live_win_probability",
    )
      ? 0.10
      : 0;
  const reliability = clamp(
    0.42 +
      Math.min(sampleSize, 8) * 0.035 +
      independentSourceBoost +
      (live ? 0.07 : 0) +
      (gameProjectionSources.length >= 3 ? 0.04 : 0),
    0.38,
    0.88,
  );

  const subjectWins = subjectProfile?.wins ?? null;
  const subjectGames = subjectProfile?.games ?? null;
  const recentResults = subjectProfile?.recentResults ?? [];
  const recentWins = recentResults.filter((result) => result === "W").length;

  return {
    probabilityBps: Math.round(clamp(probability, 0.01, 0.99) * 10_000),
    reliabilityBps: Math.round(reliability * 10_000),
    version: MODEL_VERSION,
    evidence: {
      last5Hits: recentResults.length ? recentWins : null,
      last10Hits: recentResults.length ? recentWins : null,
      seasonHits: subjectWins,
      seasonGames: subjectGames,
      sampleSize: subjectGames ?? sampleSize,
    },
    factors,
    components: {
      consensusProjection: null,
      consensusProbabilityBps:
        gameProjectionSources.find((point) => point.source === "espn_fpi")
          ?.probabilityBps ??
        gameProjectionSources.find(
          (point) => point.source === "espn_live_win_probability",
        )?.probabilityBps ??
        null,
      statisticalProbabilityBps:
        statisticalProbability === null
          ? null
          : Math.round(statisticalProbability * 10_000),
      contextAdjustmentBps: 0,
      projectionSourceCount: gameProjectionSources.length,
      projectionSources: [],
      gameProjectionSources,
      currentSeasonTeamGames:
        subjectProfile && opponentProfile
          ? {
              subject: subjectProfile.games,
              opponent: opponentProfile.games,
            }
          : null,
      projectionSeason: scheduleGame.season,
      projectionWeek: scheduleGame.week,
      learnedSourceWeightWeek: null,
      learnedCalibrationSample: calibrated.sampleSize,
      learnedCalibrationActive: calibrated.learned,
      liveCurrentValue: liveStat,
      liveProjectedFinal: liveConditional?.projectedFinal ?? null,
      liveRemainingFraction: liveConditional ? remainingFraction : null,
    },
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
    const [history, external, liveStat] = await Promise.all([
      findPublicPlayerHistory(canonical.subject, canonical.statistic),
      getExternalProjectionConsensus(
        canonical,
        scheduleGame?.week ?? null,
        scheduleGame?.season ?? 2026,
      ),
      liveGame?.state === "in"
        ? getLivePlayerStat(
            liveGame.id,
            canonical.subject,
            canonical.statistic,
          )
        : Promise.resolve(null),
    ]);
    const sample = history.values.slice(0, 20);
    const values = sample.map((row) => row.value);
    const threshold = canonical.threshold;
    const isLivePlayerMarket = liveGame?.state === "in";

    if (isLivePlayerMarket && liveStat === null) {
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
          "Live player box-score data is unavailable, so Lynerva will not price this in-game player prop from pregame inputs alone.",
        ],
      };
    }

    if (
      liveStat === null &&
      !canPublishPlayerProbability({
        hasExternalProjection: external.projection !== null,
        projectionSourceCount: external.points.length,
        minimumProjectionSources:
          canonical.family === "longest_reception" ? 3 : 1,
        historyCount: values.length,
      })
    ) {
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
          "Lynerva does not publish a player-prop probability when there is no independent weekly projection and fewer than four current-season results.",
        ],
        components: {
          consensusProjection: null,
          consensusProbabilityBps: null,
          statisticalProbabilityBps: null,
          contextAdjustmentBps: 0,
          projectionSourceCount: 0,
          projectionSources: [],
          projectionSeason: scheduleGame?.season ?? null,
          projectionWeek: scheduleGame?.week ?? null,
          learnedSourceWeightWeek: external.weightWeek,
          learnedCalibrationSample: 0,
          learnedCalibrationActive: false,
        },
      };
    }

    const distributionStdDev: Partial<Record<CanonicalMarket["family"], number>> = {
      passing_yards: 58,
      rushing_yards: 26,
      receiving_yards: 29,
      receptions: 2.25,
      longest_reception: 8.5,
    };

    const historicalMean = values.length
      ? values.slice(0, 10).reduce((sum, value) => sum + value, 0) /
        Math.min(values.length, 10)
      : null;
    const baselineProjection = external.projection ?? historicalMean;
    const familyPrior =
      distributionStdDev[canonical.family] ??
      Math.max(
        1,
        Math.abs(baselineProjection ?? threshold) * 0.35,
      );
    const playerStdDev = adaptivePlayerStdDev(familyPrior, values);

    let consensusProbability: number | null = null;
    if (external.projection !== null) {
      const countMarket =
        canonical.family === "touchdowns" ||
        canonical.family === "rushing_touchdowns" ||
        canonical.family === "receiving_touchdowns" ||
        canonical.family === "passing_touchdowns" ||
        canonical.family === "passing_interceptions";
      // Receptions are integer-valued. For integer Kalshi thresholds, use a
      // continuity-corrected boundary so P(X >= 5) is evaluated at 4.5 rather
      // than pretending receptions are perfectly continuous.
      const normalBoundary =
        canonical.family === "receptions" && Number.isInteger(threshold)
          ? threshold - 0.5
          : threshold;
      const overProbability = countMarket
        ? poissonAtLeastProbability(threshold, external.projection)
        : 1 -
          normalCdf(
            normalBoundary,
            external.projection,
            playerStdDev,
          );
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
      const ratioSensitive = ![
        "touchdowns",
        "rushing_touchdowns",
        "receiving_touchdowns",
        "passing_touchdowns",
        "passing_interceptions",
        "receptions",
      ].includes(canonical.family);
      statisticalProbability = empiricalPlayerProbability({
        historicalHitRate: historicalHits / values.length,
        recentHitRate: recentHits / last5.length,
        // A yards-above-line ratio is useful context for continuous yardage
        // props, but it is badly scaled for low-count outcomes such as 0/1 TDs
        // or 1/2 interceptions. Those families rely on hit frequency instead.
        recentPerformanceRatio:
          ratioSensitive && threshold !== 0 ? average / threshold : 1,
        sampleSize: values.length,
      });
    }

    let probability =
      consensusProbability ??
      statisticalProbability ??
      0.5;
    if (consensusProbability !== null && statisticalProbability !== null) {
      const statisticalWeight = clamp(
        0.30 + (values.length - 4) * 0.05,
        0.30,
        0.55,
      );
      probability =
        consensusProbability * (1 - statisticalWeight) +
        statisticalProbability * statisticalWeight;
    }

    const remainingFraction = remainingGameFraction(liveGame);
    const liveConditional =
      liveStat !== null && baselineProjection !== null
        ? conditionalLivePlayerProbability({
            family: canonical.family,
            direction: canonical.direction,
            threshold,
            currentValue: liveStat,
            baselineFullGameProjection: baselineProjection,
            fullGameStdDev: playerStdDev,
            remainingFraction,
          })
        : null;

    if (isLivePlayerMarket && liveStat !== null && liveConditional === null) {
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
          "Lynerva has the live player stat but cannot safely condition this prop family yet, so it is hidden instead of using a stale pregame probability.",
        ],
      };
    }

    if (liveConditional) {
      probability = liveConditional.probability;
    }

    // Keep the model estimate independent from the executable market price.
    // Previously, a one-source player projection was shrunk 28% toward the
    // current market midpoint. A price tick could therefore move both the
    // market side of the edge and Lynerva's own probability at the same time,
    // amplifying ordinary odds movement into a larger score jump. Reliability
    // already discounts one-source estimates, so the market should not be
    // allowed to feed back into the model probability itself.

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

    const indoor = Boolean(
      scheduleGame?.roof &&
      /dome|closed|indoor/i.test(scheduleGame.roof),
    );
    const weather =
      scheduleGame && !indoor
        ? await getGameWeather({
            stadium: scheduleGame.stadium,
            kickoffAt: scheduleGame.kickoffAt,
          })
        : null;
    const weatherAdjustment = weatherProbabilityAdjustment({
      family: canonical.family,
      direction: canonical.direction,
      indoor,
      weather,
    });
    contextAdjustment += weatherAdjustment;

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
        "passing_interceptions",
        "receiving_yards",
        "receptions",
        "longest_reception",
        "touchdowns",
        "rushing_touchdowns",
        "receiving_touchdowns",
      ].includes(canonical.family);
      if (environmentSensitive && environment !== 0) {
        contextAdjustment +=
          canonical.direction === "under" ? -environment : environment;
      }
    }

    if (liveConditional) {
      contextAdjustment *= remainingFraction;
    }
    probability = clamp(probability + contextAdjustment, 0.001, 0.999);
    const calibrated = liveConditional
      ? {
          probability,
          sampleSize: 0,
          learned: false,
        }
      : await selfCalibrateProbability(
          probability,
          canonical.family,
        );
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
      sourceCount >= 6
        ? 0.83
        : sourceCount === 5
          ? 0.79
          : sourceCount === 4
            ? 0.74
            : sourceCount === 3
              ? 0.69
              : sourceCount === 2
                ? 0.62
                : sourceCount === 1
                  ? 0.50
                  : statisticalProbability !== null
                    ? 0.46
                    : 0.28;
    const historyBoost =
      values.length >= 4 ? clamp(values.length / 40, 0.08, 0.22) : 0;
    const reliability = clamp(
      sourceReliability +
        historyBoost -
        dispersionPenalty +
        (liveConditional ? 0.08 : 0),
      0.30,
      liveConditional ? 0.92 : 0.88,
    );

    const factors = [
      ...(liveConditional && liveStat !== null
        ? [
            "Live player state: " +
              canonical.subject +
              " has " +
              liveStat +
              " " +
              canonical.statistic.replaceAll("_", " ") +
              " with " +
              (remainingFraction * 100).toFixed(0) +
              "% of regulation remaining. Conditional projected final: " +
              liveConditional.projectedFinal.toFixed(1) +
              ".",
          ]
        : []),
      external.projection !== null
        ? `Independent projection consensus: ${external.projection.toFixed(1)} from ${sourceCount} source${sourceCount === 1 ? "" : "s"} (${external.points.map((point) => point.source).join(", ")}).`
        : statisticalProbability !== null
          ? "Independent weekly projections are unavailable for this stat, so the estimate is carried by current-season regular-season results."
          : "Independent weekly projections are unavailable.",
      values.length >= 4
        ? `Four-game statistical model active using ${values.length} current-season regular-season games.`
        : `Statistical model locked until four current-season games; ${values.length} available now.`,
    ];
    if (gameProjection) {
      factors.push(
        `Game context retained: projected scoring environment ${gameProjection.projectedTotal.toFixed(1)} points from current regular-season team data.`,
      );
    }
    if (weather) {
      factors.push(
        `Weather context: ${weather.windMph.toFixed(0)} mph wind, ${weather.precipitationProbability.toFixed(0)}% precipitation, ${weather.temperatureF.toFixed(0)}°F.`,
      );
    } else if (indoor) {
      factors.push("Weather context: indoor game, weather neutral.");
    }
    if (contextAdjustment !== 0) {
      factors.push(
        `Context layer adjusted probability by ${(contextAdjustment * 100).toFixed(1)} percentage points.`,
      );
    }
    if (external.weightWeek !== null) {
      factors.push(
        `Source weights learned from settled player-stat results are active from Week ${external.weightWeek}.`,
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
        projectionSources: external.points.map((point) => ({
          source: point.source,
          value: point.value,
        })),
        projectionSeason: scheduleGame?.season ?? null,
        projectionWeek: scheduleGame?.week ?? null,
        learnedSourceWeightWeek: external.weightWeek,
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
