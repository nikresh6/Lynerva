import "server-only";

import { clamp } from "@/lib/utils";
import { findPublicPlayerHistory } from "@/lib/nfl/history";
import { getGameWeatherContext } from "@/lib/nfl/game-context";
import type { WeatherPoint } from "@/lib/weather";
import type {
  CanonicalMarket,
  HistoricalEvidence,
  ModelEstimate,
} from "@/lib/markets/types";

const MODEL_VERSION = "history-weather-v3";

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

export function weatherProbabilityAdjustment(input: {
  family: CanonicalMarket["family"];
  direction: CanonicalMarket["direction"];
  indoor: boolean;
  weather: WeatherPoint | null;
}) {
  if (input.indoor || !input.weather) return 0;
  if (
    ![
      "passing_yards",
      "passing_touchdowns",
      "receiving_yards",
      "receptions",
    ].includes(input.family)
  ) {
    return 0;
  }

  let adverse = 0;
  if (input.weather.windMph >= 25) adverse += 0.035;
  else if (input.weather.windMph >= 20) adverse += 0.025;
  else if (input.weather.windMph >= 15) adverse += 0.012;

  if (input.weather.precipitationProbability >= 80) adverse += 0.012;
  else if (input.weather.precipitationProbability >= 50) adverse += 0.006;

  if (input.weather.temperatureF <= 20) adverse += 0.006;
  else if (input.weather.temperatureF <= 32) adverse += 0.003;

  if (input.weather.severe) adverse += 0.008;

  const capped = Math.min(adverse, 0.045);
  if (capped === 0) return 0;
  return input.direction === "under" ? capped : -capped;
}

export async function estimateMarket(
  canonical: CanonicalMarket | null,
): Promise<ModelEstimate> {
  if (
    !canonical ||
    canonical.threshold === null ||
    canonical.statistic === null ||
    ["moneyline", "spread", "game_total"].includes(canonical.family)
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
      `20-game sample: ${historicalHits} of ${values.length} at this threshold.`,
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
