import { clamp } from "@/lib/utils";

export const ACTIVE_PROJECTION_SOURCES = [
  "fantasypros",
  "numberfire",
  "espn",
  "cbs",
  "rotoballer",
  "sleeper",
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
    const medianError = quantile(allErrors, 0.5);
    const recentMedianError = quantile(recentErrors, 0.5);
    const p90Error = quantile(allErrors, 0.9);

    // Weight sources on a robust error score rather than raw average error.
    // Median captures the normal miss, recent median lets current form matter,
    // and p90 still penalizes sources that regularly produce ugly misses.
    // One freak projection therefore cannot destroy an otherwise good source.
    const robustError =
      medianError === null
        ? null
        : 0.5 * medianError +
          0.3 * (recentMedianError ?? medianError) +
          0.2 * (p90Error ?? medianError);

    return {
      source,
      sampleSize: rows.length,
      mae,
      recentMae,
      performance:
        robustError === null ? null : 1 / Math.max(robustError, 0.25),
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
    // Small samples stay close to equal weights. The learned component ramps
    // from 0% after 20 rows to its 75% cap at 155 graded observations.
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
