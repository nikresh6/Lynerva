import { clamp } from "@/lib/utils";

export const MONEYLINE_SOURCES = [
  "nflverse_current_season_scoring",
  "nflverse_current_season_record",
  "espn_fpi",
] as const;

export type MoneylineSource = (typeof MONEYLINE_SOURCES)[number];

export const MONEYLINE_WEIGHT_PRIORS: Record<MoneylineSource, number> = {
  nflverse_current_season_scoring: 0.5,
  nflverse_current_season_record: 0.15,
  espn_fpi: 0.35,
};

export const MONEYLINE_WEIGHT_BOUNDS: Record<
  MoneylineSource,
  { min: number; max: number }
> = {
  nflverse_current_season_scoring: { min: 0.3, max: 0.65 },
  nflverse_current_season_record: { min: 0.08, max: 0.25 },
  espn_fpi: { min: 0.2, max: 0.5 },
};

export interface MoneylineWeightSample {
  source: MoneylineSource;
  probability: number;
  outcome: 0 | 0.5 | 1;
  week: number;
}

export interface LearnedMoneylineWeight {
  source: MoneylineSource;
  weight: number;
  priorWeight: number;
  sampleSize: number;
  brierScore: number | null;
}

export function blendMoneylineSourceProbabilities(
  points: Array<{ probability: number; weight: number }>,
) {
  const eligible = points.filter(
    (point) =>
      Number.isFinite(point.probability) &&
      Number.isFinite(point.weight) &&
      point.weight > 0,
  );
  const totalWeight = eligible.reduce((sum, point) => sum + point.weight, 0);
  if (totalWeight <= 0) return null;
  return clamp(
    eligible.reduce(
      (sum, point) => sum + point.probability * point.weight,
      0,
    ) / totalWeight,
    0.001,
    0.999,
  );
}

function normalizeBounded(
  candidate: Record<MoneylineSource, number>,
): Record<MoneylineSource, number> {
  const result = { ...candidate };

  for (let iteration = 0; iteration < 12; iteration += 1) {
    for (const source of MONEYLINE_SOURCES) {
      const bounds = MONEYLINE_WEIGHT_BOUNDS[source];
      result[source] = clamp(result[source], bounds.min, bounds.max);
    }

    const total = MONEYLINE_SOURCES.reduce(
      (sum, source) => sum + result[source],
      0,
    );
    const difference = 1 - total;
    if (Math.abs(difference) < 1e-10) break;

    const adjustable = MONEYLINE_SOURCES.filter((source) => {
      const bounds = MONEYLINE_WEIGHT_BOUNDS[source];
      return difference > 0
        ? result[source] < bounds.max - 1e-10
        : result[source] > bounds.min + 1e-10;
    });
    if (!adjustable.length) break;

    const capacity = adjustable.reduce((sum, source) => {
      const bounds = MONEYLINE_WEIGHT_BOUNDS[source];
      return (
        sum +
        (difference > 0
          ? bounds.max - result[source]
          : result[source] - bounds.min)
      );
    }, 0);
    if (capacity <= 0) break;

    for (const source of adjustable) {
      const bounds = MONEYLINE_WEIGHT_BOUNDS[source];
      const sourceCapacity =
        difference > 0
          ? bounds.max - result[source]
          : result[source] - bounds.min;
      result[source] += difference * (sourceCapacity / capacity);
    }
  }

  const total = MONEYLINE_SOURCES.reduce(
    (sum, source) => sum + result[source],
    0,
  );
  if (Math.abs(total - 1) > 1e-8) {
    result.nflverse_current_season_scoring += 1 - total;
  }
  return result;
}

export function calculateMoneylineWeights(
  samples: MoneylineWeightSample[],
  effectiveWeek: number,
): LearnedMoneylineWeight[] {
  // Week N results may only create weights for Week N+1. This filter makes the
  // anti-hindsight rule part of the pure calculation, not just a DB convention.
  const eligible = samples.filter((sample) => sample.week < effectiveWeek);
  const stats = Object.fromEntries(
    MONEYLINE_SOURCES.map((source) => {
      const rows = eligible.filter((sample) => sample.source === source);
      const brierScore = rows.length
        ? rows.reduce(
            (sum, row) =>
              sum + (clamp(row.probability, 0.001, 0.999) - row.outcome) ** 2,
            0,
          ) / rows.length
        : null;
      return [source, { sampleSize: rows.length, brierScore }];
    }),
  ) as Record<
    MoneylineSource,
    { sampleSize: number; brierScore: number | null }
  >;

  const scored = MONEYLINE_SOURCES.filter(
    (source) => stats[source].brierScore !== null,
  );
  const reference = scored.length
    ? Math.exp(
        scored.reduce(
          (sum, source) =>
            sum +
            MONEYLINE_WEIGHT_PRIORS[source] *
              Math.log(Math.max(stats[source].brierScore ?? 0.25, 0.025)),
          0,
        ) /
          scored.reduce(
            (sum, source) => sum + MONEYLINE_WEIGHT_PRIORS[source],
            0,
          ),
      )
    : 0.25;

  const targetStrength = Object.fromEntries(
    MONEYLINE_SOURCES.map((source) => {
      const brier = stats[source].brierScore;
      const relative =
        brier === null
          ? 1
          : clamp((reference / Math.max(brier, 0.025)) ** 0.75, 0.6, 1.65);
      return [source, MONEYLINE_WEIGHT_PRIORS[source] * relative];
    }),
  ) as Record<MoneylineSource, number>;
  const targetTotal = MONEYLINE_SOURCES.reduce(
    (sum, source) => sum + targetStrength[source],
    0,
  );

  const candidate = Object.fromEntries(
    MONEYLINE_SOURCES.map((source) => {
      const target = targetStrength[source] / targetTotal;
      // No movement through 16 samples, then gradual learning that tops out at
      // 75% influence after 176 samples. Priors always retain meaningful say.
      const confidence = clamp((stats[source].sampleSize - 16) / 160, 0, 0.75);
      return [
        source,
        MONEYLINE_WEIGHT_PRIORS[source] * (1 - confidence) +
          target * confidence,
      ];
    }),
  ) as Record<MoneylineSource, number>;
  const weights = normalizeBounded(candidate);

  return MONEYLINE_SOURCES.map((source) => ({
    source,
    weight: weights[source],
    priorWeight: MONEYLINE_WEIGHT_PRIORS[source],
    sampleSize: stats[source].sampleSize,
    brierScore: stats[source].brierScore,
  }));
}

export function priorMoneylineWeights(): LearnedMoneylineWeight[] {
  return MONEYLINE_SOURCES.map((source) => ({
    source,
    weight: MONEYLINE_WEIGHT_PRIORS[source],
    priorWeight: MONEYLINE_WEIGHT_PRIORS[source],
    sampleSize: 0,
    brierScore: null,
  }));
}
