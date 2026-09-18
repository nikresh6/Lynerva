import { clamp } from "@/lib/utils";

export const ACTIVE_PROJECTION_SOURCES = [
  "fantasypros",
  "numberfire",
  "espn",
  "cbs",
  "covers",
  "dimers",
] as const;

export type ActiveProjectionSource =
  (typeof ACTIVE_PROJECTION_SOURCES)[number];

export interface SourceGradeSample {
  source: string;
  absoluteError: number;
  gradedAt: Date;
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

export function calculateSourceWeights(
  samples: SourceGradeSample[],
  sources: readonly string[] = ACTIVE_PROJECTION_SOURCES,
): LearnedSourceWeight[] {
  const prior = 1 / Math.max(sources.length, 1);
  const bySource = new Map<string, SourceGradeSample[]>();

  for (const source of sources) bySource.set(source, []);
  for (const sample of samples) {
    if (!bySource.has(sample.source)) continue;
    bySource.get(sample.source)!.push(sample);
  }

  const metrics = sources.map((source) => {
    const rows = (bySource.get(source) ?? []).toSorted(
      (first, second) => second.gradedAt.getTime() - first.gradedAt.getTime(),
    );
    const allErrors = rows.map((row) => row.absoluteError);
    const recentErrors = rows.slice(0, 40).map((row) => row.absoluteError);
    const mae = mean(allErrors);
    const recentMae = mean(recentErrors);
    const blendedError =
      mae === null
        ? null
        : 0.65 * mae + 0.35 * (recentMae ?? mae);
    return {
      source,
      sampleSize: rows.length,
      mae,
      recentMae,
      performance:
        blendedError === null ? null : 1 / Math.max(blendedError, 0.25),
    };
  });

  const performanceTotal = metrics.reduce(
    (sum, metric) => sum + (metric.performance ?? 0),
    0,
  );

  const raw = metrics.map((metric) => {
    const learnedTarget =
      metric.performance !== null && performanceTotal > 0
        ? metric.performance / performanceTotal
        : prior;
    // Small samples stay close to equal weights. At 200+ graded observations,
    // source performance can drive up to 75% of the weight.
    const confidence = clamp((metric.sampleSize - 20) / 180, 0, 0.75);
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
