import type { Metadata } from "next";
import {
  ArrowUpRight,
  Award,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  Gauge,
  LineChart,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import {
  getProjectionSourcePerformance,
  PROJECTION_SOURCE_INFO,
  type ProjectionPerformanceRow,
} from "@/lib/model/source-performance";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

const STAT_LABELS: Record<string, string> = {
  passing_yards: "Passing yards",
  passing_touchdowns: "Passing TDs",
  passing_interceptions: "Interceptions thrown",
  rushing_yards: "Rushing yards",
  rushing_touchdowns: "Rushing TDs",
  receiving_yards: "Receiving yards",
  receiving_touchdowns: "Receiving TDs",
  receptions: "Receptions",
  touchdowns: "Any TDs",
};

const STAT_ORDER = [
  "passing_yards",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
  "receptions",
  "touchdowns",
];

function sourceName(source: string) {
  return (
    PROJECTION_SOURCE_INFO[
      source as keyof typeof PROJECTION_SOURCE_INFO
    ]?.name ?? source
  );
}

function unit(stat: string) {
  if (stat.includes("yards")) return " yd";
  if (stat === "receptions") return " rec";
  if (stat === "passing_interceptions") return " INT";
  return " TD";
}

function metric(value: number, stat: string) {
  const digits = stat.includes("yards") ? 1 : 2;
  return `${value.toFixed(digits)}${unit(stat)}`;
}

function biasLabel(value: number, stat: string) {
  if (Math.abs(value) < 0.005) return "0";
  const digits = stat.includes("yards") ? 1 : 2;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit(stat)}`;
}

function weightDelta(value: number | null) {
  if (value === null || Math.abs(value) < 0.00005) return "No prior week";
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}pp`;
}

function accuracyTone(score: number) {
  if (score >= 70) {
    return "border-positive/30 bg-positive-bg/45 text-positive";
  }
  if (score >= 45) {
    return "border-warning/30 bg-warning-bg/45 text-warning";
  }
  return "border-negative/20 bg-negative-bg/35 text-negative";
}

function PerformanceTable({
  statistic,
  rows,
}: {
  statistic: string;
  rows: ProjectionPerformanceRow[];
}) {
  const bySource = rows
    .filter((row) => row.statistic === statistic)
    .toSorted(
      (a, b) =>
        a.medianAbsoluteError - b.medianAbsoluteError ||
        b.sampleSize - a.sampleSize,
    );

  const bestSource = bySource[0]?.source ?? null;

  return (
    <section className="premium-panel overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-2 border-b bg-surface-raised/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="text-sm font-semibold">
            {STAT_LABELS[statistic] ?? statistic}
          </h3>
          <p className="mt-1 text-[11px] text-muted">
            Settled regular-season player results only.
          </p>
        </div>
        {bySource.length > 0 ? (
          <span className="w-fit rounded-full border bg-surface px-2.5 py-1 text-[9px] font-medium text-muted">
            {bySource.reduce((sum, row) => sum + row.sampleSize, 0)} graded
            samples
          </span>
        ) : null}
      </div>

      {bySource.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted">
          No settled projection samples yet.
        </div>
      ) : (
        <>
          <div className="grid gap-2 p-3 sm:hidden">
            {bySource.map((row) => (
              <div
                key={row.source}
                className="rounded-xl border bg-surface-raised/35 p-3.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {sourceName(row.source)}
                    </p>
                    <p className="mt-0.5 text-[9px] text-faint">
                      {row.sampleSize} samples
                    </p>
                  </div>
                  {row.source === bestSource ? (
                    <span className="rounded-full bg-positive-bg px-2 py-1 text-[9px] font-semibold text-positive">
                      Lowest typical miss
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-surface p-2.5">
                    <p className="text-[9px] text-faint">Typical miss</p>
                    <p className="mt-1 text-sm font-semibold tabular">
                      {metric(row.medianAbsoluteError, statistic)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-surface p-2.5">
                    <p className="text-[9px] text-faint">Bad miss</p>
                    <p className="mt-1 text-sm font-semibold tabular">
                      {metric(row.p90AbsoluteError, statistic)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-surface p-2.5">
                    <p className="text-[9px] text-faint">RMSE</p>
                    <p className="mt-1 text-xs font-medium tabular">
                      {metric(row.rmse, statistic)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-surface p-2.5">
                    <p className="text-[9px] text-faint">Bias</p>
                    <p className="mt-1 text-xs font-medium tabular">
                      {biasLabel(row.bias, statistic)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                  <span>Current model weight</span>
                  <span className="font-medium tabular text-foreground">
                    {row.weight === null
                      ? "Equal prior"
                      : `${(row.weight * 100).toFixed(1)}%${
                          row.weightWeek ? ` · W${row.weightWeek}` : ""
                        }`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b bg-background text-[10px] uppercase tracking-[0.08em] text-faint">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Typical miss</th>
                  <th className="px-3 py-2.5 font-medium">Bad miss</th>
                  <th className="px-3 py-2.5 font-medium">RMSE</th>
                  <th className="px-3 py-2.5 font-medium">Bias</th>
                  <th className="px-3 py-2.5 font-medium">Samples</th>
                  <th className="px-5 py-2.5 font-medium">Current weight</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {bySource.map((row) => (
                  <tr
                    key={row.source}
                    className="transition-colors hover:bg-surface-raised/55"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          {sourceName(row.source)}
                        </span>
                        {row.source === bestSource ? (
                          <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[8px] font-semibold text-positive">
                            Lowest typical miss
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 font-semibold tabular">
                      {metric(row.medianAbsoluteError, statistic)}
                    </td>
                    <td className="px-3 py-3.5 tabular text-muted">
                      {metric(row.p90AbsoluteError, statistic)}
                    </td>
                    <td className="px-3 py-3.5 tabular text-muted">
                      {metric(row.rmse, statistic)}
                    </td>
                    <td className="px-3 py-3.5 tabular text-muted">
                      {biasLabel(row.bias, statistic)}
                    </td>
                    <td className="px-3 py-3.5 tabular text-muted">
                      {row.sampleSize}
                    </td>
                    <td className="px-5 py-3.5 tabular">
                      {row.weight === null
                        ? "Equal prior"
                        : `${(row.weight * 100).toFixed(1)}%${
                            row.weightWeek ? ` · W${row.weightWeek}` : ""
                          }`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default async function SourcesPage() {
  const performance = await getProjectionSourcePerformance(2026);
  const gradedSamples = performance.rows.reduce(
    (sum, row) => sum + row.sampleSize,
    0,
  );
  const trackedStats = new Set(performance.rows.map((row) => row.statistic)).size;
  const maxCoverage = Math.max(
    1,
    ...performance.sources.map((source) => source.coverageCount),
  );

  return (
    <>
      <PageHeading
        title="Projection sources"
        description="See exactly what feeds Lynerva, how fresh each source is, and how each one has performed once real NFL results settle."
      />

      <div className="space-y-6">
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b bg-[radial-gradient(circle_at_12%_0%,var(--accent-bg),transparent_46%),var(--surface-raised)] p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
              <Gauge className="size-3.5" />
              Moneyline model
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
              Team win probabilities use a separate current-season data stack.
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
              Moneylines are not treated like player props. Lynerva blends
              independent game-level probability signals first, then compares
              that blended probability with the Kalshi team contract. Kalshi
              never feeds back into the model probability itself.
            </p>
          </div>

          <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-3">
            <div className="rounded-2xl border bg-surface p-4">
              <div className="flex items-center gap-2">
                <LineChart className="size-4 text-accent" />
                <h3 className="text-sm font-semibold">ESPN game projection</h3>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Pregame ESPN win projection is an independent probability
                datapoint. During games, Lynerva can use ESPN&apos;s live win
                probability instead so the estimate reacts to score and clock.
              </p>
            </div>

            <div className="rounded-2xl border bg-surface p-4">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-accent" />
                <h3 className="text-sm font-semibold">2026 nflverse scoring</h3>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Completed 2026 regular-season scores build each team&apos;s
                offense, defense, recent scoring form, projected margin, and
                game-to-game variance. Early weeks are shrunk toward the 2026
                league scoring environment rather than older seasons.
              </p>
            </div>

            <div className="rounded-2xl border bg-surface p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-accent" />
                <h3 className="text-sm font-semibold">2026 team record</h3>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Current-season wins, losses, ties, opponent record, and a small
                home-field adjustment provide a separate form signal. Preseason,
                postseason, and prior seasons are excluded from this input.
              </p>
            </div>
          </div>

          <div className="border-t bg-background/45 px-5 py-3 text-[10px] leading-5 text-muted">
            Player-source accuracy tables below remain player-stat specific.
            Moneyline probability calibration is tracked independently because
            win probabilities and yardage projection errors are different
            statistical targets.
          </div>
        </section>

        {(() => {
          const leaderboard = performance.sources
            .map((source) => {
              const sourceRows = performance.rows.filter(
                (row) => row.source === source.id,
              );
              const statScores = sourceRows.map((row) => {
                const peers = performance.rows
                  .filter((peer) => peer.statistic === row.statistic)
                  .toSorted(
                    (a, b) =>
                      a.robustError - b.robustError ||
                      b.sampleSize - a.sampleSize,
                  );
                const rank = peers.findIndex(
                  (peer) => peer.source === row.source,
                );
                const accuracyIndex =
                  rank < 0
                    ? 50
                    : peers.length <= 1
                      ? 50
                      : 100 * (1 - rank / (peers.length - 1));
                return { row, accuracyIndex };
              });
              const accuracyIndex = statScores.length
                ? statScores.reduce((sum, item) => sum + item.accuracyIndex, 0) /
                  statScores.length
                : 0;
              const weightedRows = sourceRows.filter(
                (row) => row.weight !== null,
              );
              const averageWeight = weightedRows.length
                ? weightedRows.reduce(
                    (sum, row) => sum + (row.weight ?? 0),
                    0,
                  ) / weightedRows.length
                : null;
              const trendRows = sourceRows.filter(
                (row) => row.weightChange !== null,
              );
              const averageWeightChange = trendRows.length
                ? trendRows.reduce(
                    (sum, row) => sum + (row.weightChange ?? 0),
                    0,
                  ) / trendRows.length
                : null;

              return {
                ...source,
                sourceRows,
                accuracyIndex,
                averageWeight,
                averageWeightChange,
                samples: sourceRows.reduce(
                  (sum, row) => sum + row.sampleSize,
                  0,
                ),
              };
            })
            .toSorted(
              (a, b) =>
                b.accuracyIndex - a.accuracyIndex ||
                b.samples - a.samples,
            );
          const leader = leaderboard.find((row) => row.samples > 0) ?? null;

          return (
            <section className="premium-panel overflow-hidden rounded-2xl">
              <div className="border-b bg-[radial-gradient(circle_at_12%_0%,var(--accent-bg),transparent_45%),linear-gradient(135deg,var(--surface-raised),var(--surface))] p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                      <BrainCircuit className="size-3.5" />
                      Learning leaderboard
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                      The model is learning which sources deserve more influence.
                    </h2>
                    <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
                      Sources are compared within each stat so yardage and touchdown
                      errors are never mixed together. Accuracy index is the
                      source&apos;s average rank percentile across the stats it has
                      graded. The actual model weights below come from the learning
                      loop, not from this display index.
                    </p>
                  </div>
                  {leader ? (
                    <div className="rounded-2xl border border-positive/25 bg-positive-bg/65 px-4 py-3">
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-positive">
                        <Award className="size-3.5" />
                        Overall leader
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {leader.name}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted">
                        {leader.accuracyIndex.toFixed(0)} accuracy index across{" "}
                        {leader.sourceRows.length} tracked stats
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2 xl:grid-cols-3">
                {leaderboard.map((source, index) => (
                  <details
                    key={source.id}
                    className="group overflow-hidden rounded-2xl border bg-surface"
                  >
                    <summary className="cursor-pointer list-none p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white p-1.5 shadow-[0_6px_20px_rgb(0_0_0/0.16)]">
                            <img
                              src={source.logo}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold">
                                {source.name}
                              </p>
                              {index === 0 && source.samples > 0 ? (
                                <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[8px] font-semibold text-positive">
                                  #1
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[9px] text-faint">
                              {source.samples.toLocaleString()} graded samples
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded-xl border px-2.5 py-1.5 text-right",
                            accuracyTone(source.accuracyIndex),
                          )}
                        >
                          <span className="block text-sm font-bold tabular">
                            {source.samples ? source.accuracyIndex.toFixed(0) : "—"}
                          </span>
                          <span className="block text-[8px] font-semibold uppercase tracking-[0.07em]">
                            accuracy
                          </span>
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-xl border bg-background p-2.5">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                            Model weight
                          </p>
                          <p className="mt-1 text-xs font-semibold tabular">
                            {source.averageWeight === null
                              ? "Equal prior"
                              : `${(source.averageWeight * 100).toFixed(1)}%`}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-background p-2.5">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                            Weight move
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xs font-semibold tabular",
                              (source.averageWeightChange ?? 0) > 0
                                ? "text-positive"
                                : (source.averageWeightChange ?? 0) < 0
                                  ? "text-negative"
                                  : "",
                            )}
                          >
                            {weightDelta(source.averageWeightChange)}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-background p-2.5">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                            Coverage
                          </p>
                          <p className="mt-1 text-xs font-semibold tabular">
                            {source.coverageCount.toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-[9px] font-medium text-muted">
                        <span>Click for the learning breakdown</span>
                        <TrendingUp className="size-3.5 transition-transform group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="border-t bg-background/45 p-4">
                      <p className="text-[10px] leading-5 text-muted">
                        Per-stat robust error = 50% median miss + 30% recent
                        median miss + 20% 90th-percentile miss. With small
                        samples, the learned weight stays close to an equal
                        prior. As settled samples grow, better robust error earns
                        more influence.
                      </p>

                      <div className="mt-3 space-y-2">
                        {source.sourceRows.length ? (
                          source.sourceRows
                            .toSorted((a, b) => a.statistic.localeCompare(b.statistic))
                            .map((row) => (
                              <div
                                key={row.statistic}
                                className="rounded-xl border bg-surface p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[10px] font-semibold">
                                    {STAT_LABELS[row.statistic] ?? row.statistic}
                                  </span>
                                  <span className="text-[10px] font-semibold tabular">
                                    {row.weight === null
                                      ? "Equal prior"
                                      : `${(row.weight * 100).toFixed(1)}%`}
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] text-muted">
                                  <span>
                                    Typical {metric(row.medianAbsoluteError, row.statistic)}
                                  </span>
                                  <span>
                                    Recent {metric(row.recentMedianAbsoluteError, row.statistic)}
                                  </span>
                                  <span>
                                    Bad miss {metric(row.p90AbsoluteError, row.statistic)}
                                  </span>
                                  <span>
                                    Robust {metric(row.robustError, row.statistic)}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[9px]">
                                  <span className="text-faint">
                                    {row.sampleSize} samples
                                  </span>
                                  <span
                                    className={cn(
                                      "font-semibold tabular",
                                      (row.weightChange ?? 0) > 0
                                        ? "text-positive"
                                        : (row.weightChange ?? 0) < 0
                                          ? "text-negative"
                                          : "text-muted",
                                    )}
                                  >
                                    {weightDelta(row.weightChange)}
                                  </span>
                                </div>
                              </div>
                            ))
                        ) : (
                          <p className="text-[10px] text-muted">
                            No settled samples yet. This source remains near the
                            equal prior until the learning loop has evidence.
                          </p>
                        )}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          );
        })()}
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="grid gap-0 md:grid-cols-[1.35fr_1fr]">
            <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] p-5 md:border-b-0 md:border-r sm:p-6">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                <ShieldCheck className="size-3.5" />
                Transparent data stack
              </div>
              <h2 className="mt-3 max-w-xl text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
                Free weekly projections in, settled NFL results back out.
              </h2>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
                Lynerva only accepts the requested NFL week from these sources.
                If a source is missing, stale, or serving season-long data, it
                stays missing instead of being silently substituted.
              </p>
            </div>

            <div className="grid grid-cols-2">
              <div className="border-b border-r p-4 sm:p-5">
                <p className="text-[10px] text-faint">Free sources</p>
                <p className="mt-1 text-2xl font-semibold tabular">
                  {performance.sources.length}
                </p>
              </div>
              <div className="border-b p-4 sm:p-5">
                <p className="text-[10px] text-faint">Coverage week</p>
                <p className="mt-1 text-2xl font-semibold tabular">
                  {performance.coverageWeek === null
                    ? "Pending"
                    : `W${performance.coverageWeek}`}
                </p>
              </div>
              <div className="border-r p-4 sm:p-5">
                <p className="text-[10px] text-faint">Graded samples</p>
                <p className="mt-1 text-2xl font-semibold tabular">
                  {gradedSamples.toLocaleString()}
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[10px] text-faint">Stats tracked</p>
                <p className="mt-1 text-2xl font-semibold tabular">
                  {trackedStats || STAT_ORDER.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Active free sources</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
                Every outside projection source currently allowed into the
                model. Open any card to inspect the public source directly.
              </p>
            </div>
            <p className="text-[10px] text-faint">
              No paid API key or paid account required
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {performance.sources.map((source) => {
              const coverageShare = source.coverageCount / maxCoverage;
              const sourceRows = performance.rows.filter(
                (row) => row.source === source.id,
              );
              const sourceSamples = sourceRows.reduce(
                (sum, row) => sum + row.sampleSize,
                0,
              );
              const coveredStats = new Set(
                sourceRows.map((row) => row.statistic),
              ).size;

              return (
                <a
                  key={source.id}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="premium-panel group relative overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-[0_16px_42px_var(--accent-glow)] sm:p-5"
                >
                  <div className="absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_18%_0%,var(--accent-bg),transparent_72%)] opacity-75" />
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent opacity-70" />

                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white p-1.5 shadow-[0_8px_24px_rgb(0_0_0/0.16)]">
                        <img
                          src={source.logo}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">
                          {source.name}
                        </h3>
                        <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.08em] text-faint">
                          {source.kind}
                        </p>
                      </div>
                    </div>

                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-positive-bg px-2 py-1 text-[9px] font-semibold text-positive">
                      <CheckCircle2 className="size-3" />
                      Free
                    </span>
                  </div>

                  <p className="mt-4 text-xs font-medium">{source.access}</p>
                  <p className="mt-1.5 min-h-10 text-[11px] leading-5 text-muted">
                    {source.note}
                  </p>

                  <div className="mt-4 rounded-xl border bg-surface-raised/45 p-3">
                    <div className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="text-muted">
                        {performance.coverageWeek === null
                          ? "Current-week coverage"
                          : `Week ${performance.coverageWeek} coverage`}
                      </span>
                      <span className="font-semibold tabular">
                        {source.coverageCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-foreground/70"
                        style={{
                          width: `${Math.max(
                            source.coverageCount > 0 ? 4 : 0,
                            coverageShare * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[9px] text-faint">
                      <span>{sourceSamples.toLocaleString()} graded</span>
                      <span>{coveredStats} stats with history</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-[10px] font-medium">
                    <span>Open public source</span>
                    <ArrowUpRight className="size-3.5 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        <section className="premium-panel rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-muted" />
            <h2 className="text-sm font-semibold">How accuracy is measured</h2>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted">
            There is no fake universal source score. Each stat is graded in its
            own units, then Lynerva learns weights from multiple error measures.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-surface-raised/35 p-4">
              <div className="grid size-8 place-items-center rounded-lg border bg-surface">
                <BarChart3 className="size-3.5 text-muted" />
              </div>
              <p className="mt-3 text-xs font-semibold">Typical miss</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Median absolute error. Half of a source&apos;s settled
                projections miss by less, and half miss by more.
              </p>
            </div>

            <div className="rounded-xl border bg-surface-raised/35 p-4">
              <div className="grid size-8 place-items-center rounded-lg border bg-surface">
                <LineChart className="size-3.5 text-muted" />
              </div>
              <p className="mt-3 text-xs font-semibold">Bad miss</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                90th percentile absolute error. It shows how ugly the worse
                misses get instead of hiding them inside an average.
              </p>
            </div>

            <div className="rounded-xl border bg-surface-raised/35 p-4">
              <div className="grid size-8 place-items-center rounded-lg border bg-surface">
                <Database className="size-3.5 text-muted" />
              </div>
              <p className="mt-3 text-xs font-semibold">Bias + RMSE</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Bias shows whether a source tends high or low. RMSE adds a
                heavier penalty when a projection misses badly.
              </p>
            </div>
          </div>

          <p className="mt-4 text-[10px] leading-4 text-faint">
            Only projections captured before kickoff are graded, and only
            against regular-season results. Learned source weights combine
            typical miss, recent typical miss, and 90th-percentile miss. Small
            samples stay close to equal weight until enough settled player-weeks
            accumulate.
          </p>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">
              {performance.season} source accuracy by stat
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
              Compare sources within the same stat. Yardage error, receptions,
              interceptions, and touchdowns use different units, so they are
              intentionally kept separate.
            </p>
          </div>
          <div className="grid gap-4">
            {STAT_ORDER.map((statistic) => (
              <PerformanceTable
                key={statistic}
                statistic={statistic}
                rows={performance.rows}
              />
            ))}
          </div>
        </section>

        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="grid md:grid-cols-[auto_1fr_auto] md:items-center">
            <div className="grid min-h-24 place-items-center border-b bg-surface-raised p-5 md:min-h-full md:w-24 md:border-b-0 md:border-r">
              <Database className="size-5 text-muted" />
            </div>
            <div className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold">Ground truth: nflverse</h2>
              <p className="mt-1.5 max-w-4xl text-xs leading-5 text-muted">
                Settled player results come from the open-source nflverse data
                project. Those realized NFL stats grade every stored projection
                and feed Lynerva&apos;s source-weight learning loop. Current roster
                metadata and player headshot URLs also come from nflverse so the
                interface can show real player identity without a paid media API.
                Kalshi prices are pulled separately and are never treated as an
                outside player projection.
              </p>
            </div>
            <div className="border-t p-4 md:border-l md:border-t-0 sm:p-5">
              <a
                href="https://github.com/nflverse/nflverse-data"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border bg-surface-raised px-3 py-2 text-xs font-medium transition-colors hover:bg-background"
              >
                Open on GitHub
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
