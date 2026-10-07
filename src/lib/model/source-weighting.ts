import { clamp } from "@/lib/utils";

export const ACTIVE_PROJECTION_SOURCES = [
  "fantasypros",
  "numberfire",
  "espn",
  "cbs",
  "rotoballer",
  "sleeper",
  "covers",
  "dimers",
] as const;

export type ActiveProjectionSource =
  (typeof ACTIVE_PROJECTION_SOURCES)[number];

export const PROJECTION_STATISTICS = [
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "receptions",
  "receiving_yards",
  "receiving_touchdowns",
  "touchdowns",
] as const;

export type ProjectionLearningStatistic =
  (typeof PROJECTION_STATISTICS)[number];

const ALL_PROJECTION_STATISTICS = [...PROJECTION_STATISTICS];

export const PROJECTION_SOURCE_STATISTICS: Record<
  ActiveProjectionSource,
  readonly ProjectionLearningStatistic[]
> = {
  fantasypros: ALL_PROJECTION_STATISTICS,
  numberfire: ALL_PROJECTION_STATISTICS,
  espn: ALL_PROJECTION_STATISTICS,
  cbs: ALL_PROJECTION_STATISTICS,
  rotoballer: ALL_PROJECTION_STATISTICS,
  sleeper: ALL_PROJECTION_STATISTICS,
  covers: [
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "receptions",
  ],
  dimers: [
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "receptions",
    "touchdowns",
  ],
};

export function sourceSupportsStatistic(
  source: string,
  statistic: string,
) {
  if (!(source in PROJECTION_SOURCE_STATISTICS)) return false;
  return PROJECTION_SOURCE_STATISTICS[source as ActiveProjectionSource].includes(
    statistic as ProjectionLearningStatistic,
  );
}

export function projectionSourcesForStatistic(statistic: string) {
  return ACTIVE_PROJECTION_SOURCES.filter((source) =>
    sourceSupportsStatistic(source, statistic),
  );
}

export interface SourceGradeSample {
  source: string;
  absoluteError: number;
  gradedAt: Date;
  statistic?: string;
  projectedValue?: number;
  actualValue?: number;
}

export interface SourceAccuracyMetric {
  source: string;
  rawSampleSize: number;
  effectiveSampleSize: number;
  mae: number | null;
  recentMae: number | null;
  normalizedMedianError: number | null;
  normalizedRecentMedianError: number | null;
  normalizedP90Error: number | null;
  normalizedRobustError: number | null;
}

export interface LearnedSourceWeight {
  source: string;
  weight: number;
  sampleSize: number;
  mae: number | null;
  recentMae: number | null;
}

export function normalizeLearningPlayer(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? null;
  const fraction = index - lower;
  return (
    (sorted[lower] ?? 0) * (1 - fraction) +
    (sorted[upper] ?? 0) * fraction
  );
}

type WeightedError = {
  value: number;
  weight: number;
};

function weightedQuantile(points: WeightedError[], q: number) {
  const eligible = points
    .filter(
      (point) =>
        Number.isFinite(point.value) &&
        Number.isFinite(point.weight) &&
        point.weight > 0,
    )
    .toSorted((a, b) => a.value - b.value);
  if (!eligible.length) return null;

  const totalWeight = eligible.reduce((sum, point) => sum + point.weight, 0);
  const target = totalWeight * clamp(q, 0, 1);
  let cumulative = 0;
  for (const point of eligible) {
    cumulative += point.weight;
    if (cumulative >= target) return point.value;
  }
  return eligible.at(-1)?.value ?? null;
}

function gradeMagnitude(sample: SourceGradeSample) {
  if (
    sample.projectedValue === undefined ||
    sample.actualValue === undefined ||
    !Number.isFinite(sample.projectedValue) ||
    !Number.isFinite(sample.actualValue)
  ) {
    return null;
  }

  return Math.max(
    Math.abs(sample.projectedValue),
    Math.abs(sample.actualValue),
  );
}

export function calculateSourceAccuracyMetrics(
  samples: SourceGradeSample[],
  sources: readonly string[] = ACTIVE_PROJECTION_SOURCES,
): SourceAccuracyMetric[] {
  const byStatistic = new Map<string, SourceGradeSample[]>();
  for (const sample of samples) {
    const statistic = sample.statistic ?? "__legacy__";
    const rows = byStatistic.get(statistic) ?? [];
    rows.push(sample);
    byStatistic.set(statistic, rows);
  }

  const normalizedBySample = new Map<
    SourceGradeSample,
    { normalizedError: number; informationWeight: number }
  >();

  for (const rows of byStatistic.values()) {
    const magnitudes = rows
      .map(gradeMagnitude)
      .filter((value): value is number => value !== null && value > 0);
    const bySource = new Map<string, number[]>();
    for (const sample of rows) {
      const magnitude = gradeMagnitude(sample);
      if (magnitude === null || magnitude <= 0) continue;
      const values = bySource.get(sample.source) ?? [];
      values.push(magnitude);
      bySource.set(sample.source, values);
    }
    const sourceReferenceMagnitudes = [...bySource.values()]
      .map((values) => quantile(values, 0.75))
      .filter((value): value is number => value !== null && value > 0);
    // Coverage breadth must not define the scale. If one provider publishes
    // hundreds of WR5 rows, those extra tiny values cannot drag the reference
    // magnitude down and turn zero-usage calls into an accuracy advantage.
    const referenceMagnitude = Math.max(
      quantile(magnitudes, 0.8) ?? 0,
      quantile(sourceReferenceMagnitudes, 0.75) ?? 0,
    );

    for (const sample of rows) {
      const magnitude = gradeMagnitude(sample);
      if (magnitude === null || referenceMagnitude === null) {
        // Legacy/tests without projection context retain the old absolute-error
        // behavior instead of being silently reinterpreted.
        normalizedBySample.set(sample, {
          normalizedError: sample.absoluteError,
          informationWeight: 1,
        });
        continue;
      }

      const safeReference = Math.max(referenceMagnitude, 1e-6);
      const normalizationFloor = Math.max(safeReference * 0.2, 1e-6);
      normalizedBySample.set(sample, {
        // Scale the miss by the size of the actual prediction problem. A
        // 3-yard miss on a 125-yard result is meaningfully better than a
        // 1-yard miss on a player projected for essentially no usage.
        normalizedError:
          sample.absoluteError / Math.max(magnitude, normalizationFloor),
        // Near-zero bench calls are low-information observations. They stay in
        // the audit trail, but cannot manufacture hundreds of "easy" grades.
        informationWeight: clamp(magnitude / safeReference, 0, 1),
      });
    }
  }

  return sources.map((source) => {
    const rows = samples
      .filter((sample) => sample.source === source)
      .toSorted(
        (first, second) =>
          second.gradedAt.getTime() - first.gradedAt.getTime(),
      );
    const recentRows = rows.slice(0, 40);
    const allErrors = rows.map((row) => row.absoluteError);
    const recentErrors = recentRows.map((row) => row.absoluteError);
    const scored = rows.map((row) => ({
      value: normalizedBySample.get(row)?.normalizedError ?? row.absoluteError,
      weight: normalizedBySample.get(row)?.informationWeight ?? 1,
    }));
    const recentScored = recentRows.map((row) => ({
      value: normalizedBySample.get(row)?.normalizedError ?? row.absoluteError,
      weight: normalizedBySample.get(row)?.informationWeight ?? 1,
    }));

    const normalizedMedianError = weightedQuantile(scored, 0.5);
    const normalizedRecentMedianError = weightedQuantile(recentScored, 0.5);
    const normalizedP90Error = weightedQuantile(scored, 0.9);
    const recentEffectiveSampleSize = recentScored.reduce(
      (sum, point) => sum + point.weight,
      0,
    );
    const recentConfidence = clamp(recentEffectiveSampleSize / 20, 0, 1);
    const recentComponent =
      normalizedMedianError === null
        ? null
        : normalizedMedianError +
          recentConfidence *
            ((normalizedRecentMedianError ?? normalizedMedianError) -
              normalizedMedianError);
    const normalizedRobustError =
      normalizedMedianError === null
        ? null
        : 0.5 * normalizedMedianError +
          0.3 * (recentComponent ?? normalizedMedianError) +
          0.2 * (normalizedP90Error ?? normalizedMedianError);

    return {
      source,
      rawSampleSize: rows.length,
      effectiveSampleSize: scored.reduce(
        (sum, point) => sum + point.weight,
        0,
      ),
      mae: mean(allErrors),
      recentMae: mean(recentErrors),
      normalizedMedianError,
      normalizedRecentMedianError,
      normalizedP90Error,
      normalizedRobustError,
    };
  });
}

export function calculateSourceWeights(
  samples: SourceGradeSample[],
  sources: readonly string[] = ACTIVE_PROJECTION_SOURCES,
): LearnedSourceWeight[] {
  const prior = 1 / Math.max(sources.length, 1);
  const accuracy = calculateSourceAccuracyMetrics(samples, sources);
  const metrics = accuracy.map((metric) => ({
    source: metric.source,
    sampleSize: metric.rawSampleSize,
    effectiveSampleSize: metric.effectiveSampleSize,
    mae: metric.mae,
    recentMae: metric.recentMae,
    performance:
      metric.normalizedRobustError === null
        ? null
        : 1 / Math.max(metric.normalizedRobustError, 0.01),
  }));

  const performanceTotal = metrics.reduce(
    (sum, metric) => sum + (metric.performance ?? 0),
    0,
  );

  const raw = metrics.map((metric) => {
    const learnedTarget =
      metric.performance !== null && performanceTotal > 0
        ? metric.performance / performanceTotal
        : prior;
    // Confidence uses starter-equivalent information, not raw row count.
    // Trivial near-zero projections therefore cannot create fake certainty.
    const confidence = clamp(
      (metric.effectiveSampleSize - 20) / 180,
      0,
      0.75,
    );
    return {
      ...metric,
      rawWeight:
        prior * (1 - confidence) + learnedTarget * confidence,
    };
  });

  const total = raw.reduce((sum, metric) => sum + metric.rawWeight, 0) || 1;
  return raw.map((metric) => ({
    source: metric.source,
    weight: metric.rawWeight / total,
    sampleSize: metric.sampleSize,
    mae: metric.mae,
    recentMae: metric.recentMae,
  }));
}
