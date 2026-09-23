"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PerformanceRow = {
  source: string;
  statistic: string;
  sampleSize: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  p90AbsoluteError: number;
  recentMedianAbsoluteError: number;
  robustError: number;
  rmse: number;
  bias: number;
  learnedTarget: number;
  confidence: number;
  examples: Array<{
    playerName: string;
    week: number;
    projectedValue: number;
    actualValue: number;
    absoluteError: number;
  }>;
  weight: number | null;
  baselineWeight: number;
  previousWeight: number | null;
  previousWeightWeek: number | null;
  weightChange: number | null;
  weightWeek: number | null;
  weightHistory: Array<{
    week: number;
    weight: number;
  }>;
};

type MoneylinePerformanceRow = {
  source: string;
  sampleSize: number;
  brierScore: number;
  accuracy: number;
  logLoss: number;
  weight: number | null;
  priorWeight: number;
  effectiveWeek: number | null;
  previousWeight: number | null;
  previousEffectiveWeek: number | null;
  examples: Array<{
    week: number;
    matchup: string;
    subject: string;
    probabilityBps: number;
    outcome: 0 | 0.5 | 1;
  }>;
};

type SourceSummary = {
  id: string;
  name: string;
  kind: string;
  href: string;
  access: string;
  note: string;
  moneylineOnly: boolean;
  coverageCount: number;
  lastCapturedAt: string | null;
  lastGradedAt: string | null;
};

const STAT_LABELS: Record<string, string> = {
  moneyline: "Moneylines",
  passing_yards: "Pass yards",
  passing_touchdowns: "Pass TDs",
  passing_interceptions: "Interceptions",
  rushing_yards: "Rush yards",
  rushing_touchdowns: "Rush TDs",
  receiving_yards: "Receiving yards",
  receiving_touchdowns: "Receiving TDs",
  receptions: "Receptions",
  longest_reception: "Longest catch",
  touchdowns: "Anytime TD",
};

function statLabel(stat: string) {
  return STAT_LABELS[stat] ?? stat.replaceAll("_", " ");
}

function errorUnit(stat: string) {
  if (stat.includes("yards") || stat === "longest_reception") return "yd";
  if (stat.includes("touchdown") || stat === "touchdowns") return "TD";
  if (stat === "receptions") return "rec";
  if (stat === "passing_interceptions") return "INT";
  return "";
}

function timeLabel(value: string | null, generatedAt: string) {
  if (!value) return "Waiting for first update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";
  const elapsed = Math.max(
    0,
    new Date(generatedAt).getTime() - date.getTime(),
  );
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Updated within the hour";
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function exactTime(value: string | null) {
  if (!value) return "No successful update recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function trend(row: PerformanceRow) {
  if (row.weight === null || row.weightWeek === null) {
    return { label: "Waiting for first learned week", Icon: Minus, tone: "text-faint" };
  }

  const change = row.weightChange ?? row.weight - row.baselineWeight;
  const comparison =
    row.previousWeightWeek === null
      ? "vs start"
      : `vs W${row.previousWeightWeek}`;
  const prefix = `W${row.weightWeek}`;

  if (Math.abs(change) < 0.0005) {
    return {
      label: `${prefix} unchanged ${comparison}`,
      Icon: Minus,
      tone: "text-faint",
    };
  }
  if (change > 0) {
    return {
      label: `${prefix} +${(change * 100).toFixed(1)} pp ${comparison}`,
      Icon: TrendingUp,
      tone: "text-positive",
    };
  }
  return {
    label: `${prefix} ${(change * 100).toFixed(1)} pp ${comparison}`,
    Icon: TrendingDown,
    tone: "text-negative",
  };
}

export function SourceDashboard({
  season,
  coverageWeek,
  rows,
  moneylineRows,
  sources,
  generatedAt,
}: {
  season: number;
  coverageWeek: number | null;
  rows: PerformanceRow[];
  moneylineRows: MoneylinePerformanceRow[];
  sources: SourceSummary[];
  generatedAt: string;
}) {
  const stats = useMemo(() => {
    const playerStats = [...new Set(rows.map((row) => row.statistic))].toSorted(
      (a, b) => statLabel(a).localeCompare(statLabel(b)),
    );
    return [...playerStats, "moneyline"];
  }, [rows]);
  const [selectedStat, setSelectedStat] = useState(stats[0] ?? "passing_yards");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const selectedRows = rows
    .filter((row) => row.statistic === selectedStat)
    .toSorted(
      (first, second) =>
        first.robustError - second.robustError ||
        second.sampleSize - first.sampleSize,
    );

  const selectedMoneylineRows = moneylineRows.toSorted(
    (first, second) =>
      first.brierScore - second.brierScore ||
      second.sampleSize - first.sampleSize,
  );
  const playerSourceCount = sources.filter((source) => !source.moneylineOnly).length;

  const totalGrades =
    rows.reduce((sum, row) => sum + row.sampleSize, 0) +
    moneylineRows.reduce((sum, row) => sum + row.sampleSize, 0);
  const newestProjection =
    sources
      .map((source) => source.lastCapturedAt)
      .filter((value): value is string => Boolean(value))
      .toSorted()
      .at(-1) ?? null;
  const newestGrade =
    sources
      .map((source) => source.lastGradedAt)
      .filter((value): value is string => Boolean(value))
      .toSorted()
      .at(-1) ?? null;
  const sourcesReporting = sources.filter(
    (source) => source.coverageCount > 0,
  ).length;

  return (
    <div className="space-y-8">
      <section className="source-hero overflow-hidden rounded-[26px] border bg-surface p-5 sm:p-7 lg:p-9">
        <div className="grid gap-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className="size-1.5 rounded-full bg-positive" />
              Source room
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              See which projections earn influence.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Huddlemark records every source before kickoff, grades it against
              the real box score, and gives more influence to sources that miss
              by less. No source gets a permanent favorite seat.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            {[
              ["Current slate", coverageWeek ? `Week ${coverageWeek}` : "Waiting"],
              ["Reporting", `${sourcesReporting}/${sources.length} sources`],
              ["Graded rows", totalGrades.toLocaleString()],
              ["Season", String(season)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border bg-background/70 p-3.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">
                  {label}
                </p>
                <p className="mt-2 text-base font-semibold tabular">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="freshness-heading">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Freshness</p>
            <h2 id="freshness-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
              When each pipeline last checked in
            </h2>
          </div>
          <p className="text-xs text-muted">Times come from successful database writes.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border bg-surface p-5">
            <div className="flex items-center gap-2 text-accent">
              <Database className="size-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Projection refresh</span>
            </div>
            <p className="mt-4 text-xl font-semibold">{timeLabel(newestProjection, generatedAt)}</p>
            <p className="mt-1 text-xs text-muted">{exactTime(newestProjection)}</p>
          </div>
          <div className="rounded-2xl border bg-surface p-5">
            <div className="flex items-center gap-2 text-positive">
              <CheckCircle2 className="size-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Result grading</span>
            </div>
            <p className="mt-4 text-xl font-semibold">{timeLabel(newestGrade, generatedAt)}</p>
            <p className="mt-1 text-xs text-muted">{exactTime(newestGrade)}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="source-cards-heading">
        <div className="mb-4">
          <p className="eyebrow">The lineup</p>
          <h2 id="source-cards-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
            One card per source. No duplicate dashboards.
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
            A common player prop can use up to {playerSourceCount} independent player-projection sources. “Published rows” counts player-and-stat projections—not players—and stays lower when a source has not posted that week, omits a stat, or keeps a row behind a paywall.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sources.map((source) => {
            const sourceRows = rows.filter((row) => row.source === source.id);
            const moneylineRow = moneylineRows.find((row) => row.source === source.id);
            const graded = source.moneylineOnly
              ? moneylineRow?.sampleSize ?? 0
              : sourceRows.reduce((sum, row) => sum + row.sampleSize, 0);
            const best = sourceRows.toSorted(
              (a, b) => a.robustError - b.robustError,
            )[0];
            return (
              <article
                key={source.id}
                className={cn(
                  "group rounded-2xl border bg-surface p-5 transition-colors",
                  source.moneylineOnly
                    ? "border-amber-400/45 hover:border-amber-300/70"
                    : "hover:border-border-strong",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background text-sm font-bold text-accent">
                      {source.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate font-semibold">{source.name}</h3>
                        {source.moneylineOnly ? (
                          <span className="shrink-0 rounded-full border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-amber-300">
                            ML
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-faint">{source.kind}</p>
                    </div>
                  </div>
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${source.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground"
                  >
                    <ArrowUpRight className="size-4" />
                  </a>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Published rows</p>
                    <p className="mt-1 text-sm font-semibold tabular">{source.coverageCount}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Graded</p>
                    <p className="mt-1 text-sm font-semibold tabular">{graded.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Best at</p>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {source.moneylineOnly ? "Moneylines" : best ? statLabel(best.statistic) : "Waiting"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t pt-3 text-[10px] text-muted">
                  <Clock3 className="size-3.5" />
                  <span title={exactTime(source.lastCapturedAt)}>
                    {timeLabel(source.lastCapturedAt, generatedAt)}
                  </span>
                </div>
                <details className="mt-3 text-[11px] text-muted">
                  <summary className="cursor-pointer font-medium text-foreground/80">How it is used</summary>
                  <p className="mt-2 leading-5">{source.note}</p>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="stat-board-heading" className="rounded-[24px] border bg-surface p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Head-to-head</p>
            <h2 id="stat-board-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
              Who is best at each stat?
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
              {selectedStat === "moneyline"
                ? "Moneylines are ranked by Brier score. Lower is better because the score rewards accurate probabilities and penalizes confident misses, instead of only counting who picked the winner."
                : "“Typical miss” is a robust error score, not a mystery average. Click any source to see the exact formula, its real graded player examples, and how that error turns into model influence."}
            </p>
          </div>
          <div className="scrollbar-subtle flex max-w-full gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Projection statistic">
            {(stats.length ? stats : [selectedStat]).map((stat) => (
              <button
                key={stat}
                type="button"
                role="tab"
                aria-selected={selectedStat === stat}
                onClick={() => setSelectedStat(stat)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold transition-colors",
                  selectedStat === stat
                    ? "bg-foreground text-background"
                    : "bg-background text-muted hover:text-foreground",
                )}
              >
                {statLabel(stat)}
              </button>
            ))}
          </div>
        </div>

        {selectedStat === "moneyline" ? (
          <div className="mt-5 space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              {[
                ["50% starting prior · Scoring", "Each team’s current-season points scored and allowed are blended with its opponent, pulled toward the league average while the sample is small, adjusted for current roster availability, recent form, and home field, then converted from projected margin to win chance."],
                ["15% starting prior · Record", "Smoothed wins, losses, and ties for both teams create a separate win chance. A small home-field adjustment is included, and the output is capped so an early record cannot become overconfident."],
                ["35% starting prior · ESPN FPI", "ESPN’s raw saved pregame win probability supplies the independent outside view. After enough frozen games, lower-Brier sources gradually earn more weight for a future week; ESPN itself is never modified by Huddlemark’s injury layer."],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-300">{label}</p>
                  <p className="mt-2 text-[10px] leading-5 text-muted">{copy}</p>
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-2xl border border-amber-400/30">
            <div className="hidden grid-cols-[1.2fr_0.7fr_0.8fr_0.9fr] gap-3 border-b bg-background px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint sm:grid">
              <span>Source</span>
              <span>Graded games</span>
              <span>Brier score</span>
              <span>Current weight</span>
            </div>
            {selectedMoneylineRows.length ? (
              selectedMoneylineRows.map((row, index) => {
                const source = sources.find((item) => item.id === row.source);
                return (
                  <div
                    key={`moneyline:${row.source}`}
                    className="grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[1.2fr_0.7fr_0.8fr_0.9fr] sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                        index === 0
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-background text-muted",
                      )}>
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{source?.name ?? row.source}</p>
                          <span className="shrink-0 rounded-full border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-amber-300">
                            ML
                          </span>
                        </div>
                        <p className={cn("text-[9px]", index === 0 ? "text-amber-300" : "text-faint")}>
                          {index === 0 ? "Lowest Brier score so far" : "Pregame moneyline probability"}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Graded games</p>
                      <p className="text-sm font-semibold tabular">{row.sampleSize.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Brier score</p>
                      <p className="text-sm font-semibold tabular">{row.brierScore.toFixed(3)}</p>
                      <p className="text-[9px] text-faint">Log loss {row.logLoss.toFixed(3)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Current weight</p>
                      <p className="text-sm font-semibold tabular">
                        {((row.weight ?? row.priorWeight) * 100).toFixed(1)}%
                      </p>
                      <p className="text-[9px] text-faint">
                        {row.effectiveWeek === null
                          ? `Starting prior · ${(row.accuracy * 100).toFixed(1)}% winners`
                          : `Effective W${row.effectiveWeek} · ${(row.accuracy * 100).toFixed(1)}% winners`}
                      </p>
                    </div>

                    {row.examples.length ? (
                      <div className="sm:col-span-4 mt-1 grid gap-2 border-t pt-3 md:grid-cols-3">
                        {row.examples.map((example) => (
                          <div
                            key={`${row.source}:${example.week}:${example.matchup}`}
                            className="rounded-xl border bg-background p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
                                W{example.week} · {example.matchup.replace("-", " vs ")}
                              </p>
                              <span className="text-[8px] text-amber-300">ML</span>
                            </div>
                            <p className="mt-2 text-xs font-semibold">
                              {example.subject} {(example.probabilityBps / 100).toFixed(1)}%
                            </p>
                            <p className="mt-1 text-[9px] text-muted">
                              {example.outcome === 0.5
                                ? "Game tied"
                                : example.outcome === 1
                                  ? `${example.subject} won`
                                  : `${example.subject} lost`}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="font-medium">Waiting for frozen moneyline source grades.</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Huddlemark only grades moneyline probabilities that were actually saved before kickoff. It will not reconstruct old forecasts with hindsight.
                </p>
              </div>
            )}
            <div className="border-t bg-amber-400/5 px-4 py-3 text-[9px] leading-4 text-muted">
              Brier score = average (forecast probability − actual result)². Perfect is 0.000; a constant 50/50 forecast scores 0.250. Lower is better.
            </div>
            </div>
          </div>
        ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border">
          <div className="hidden grid-cols-[1.2fr_0.7fr_0.8fr_0.9fr] gap-3 border-b bg-background px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint sm:grid">
            <span>Source</span>
            <span>Graded</span>
            <span>Typical miss</span>
            <span>Model influence</span>
          </div>
          {selectedRows.length ? (
            selectedRows.map((row, index) => {
              const source = sources.find((item) => item.id === row.source);
              const rowTrend = trend(row);
              const TrendIcon = rowTrend.Icon;
              const key = `${row.source}:${row.statistic}`;
              const expanded = expandedKey === key;
              const unit = errorUnit(row.statistic);
              const formula =
                `0.50 × ${row.medianAbsoluteError.toFixed(1)} + 0.30 × ${row.recentMedianAbsoluteError.toFixed(1)} + 0.20 × ${row.p90AbsoluteError.toFixed(1)} = ${row.robustError.toFixed(1)} ${unit}`;
              return (
                <div key={key} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedKey(expanded ? null : key)}
                    className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-background/55 sm:grid-cols-[1.2fr_0.7fr_0.8fr_0.9fr] sm:items-center"
                    aria-expanded={expanded}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                        index === 0 ? "bg-positive-bg text-positive" : "bg-background text-muted",
                      )}>
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{source?.name ?? row.source}</p>
                        {index === 0 ? <p className="text-[9px] text-positive">Lowest error so far</p> : <p className="text-[9px] text-faint">Click for calculation</p>}
                      </div>
                      <ChevronDown className={cn("size-4 shrink-0 text-faint transition-transform sm:hidden", expanded && "rotate-180")} />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Graded</p>
                      <p className="text-sm font-semibold tabular">{row.sampleSize.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Typical miss</p>
                      <p className="text-sm font-semibold tabular">{row.robustError.toFixed(1)} {unit}</p>
                      <p className="text-[9px] text-faint">Bias {row.bias >= 0 ? "+" : ""}{row.bias.toFixed(1)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Model influence</p>
                        <p className="text-sm font-semibold tabular">{row.weight === null ? "Waiting" : `${(row.weight * 100).toFixed(1)}%`}</p>
                        <p className={cn("mt-0.5 inline-flex items-center gap-1 text-[9px]", rowTrend.tone)}>
                          <TrendIcon className="size-3" />
                          {rowTrend.label}
                        </p>
                      </div>
                      <ChevronDown className={cn("hidden size-4 shrink-0 text-faint transition-transform sm:block", expanded && "rotate-180")} />
                    </div>
                  </button>

                  {expanded ? (
                    <div className="border-t bg-background/45 px-4 py-5 sm:px-6">
                      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
                            Exact typical-miss calculation
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <div className="rounded-xl border bg-surface p-3">
                              <p className="text-[8px] uppercase tracking-[0.08em] text-faint">50% normal miss</p>
                              <p className="mt-1 text-lg font-semibold tabular">{row.medianAbsoluteError.toFixed(1)} {unit}</p>
                              <p className="mt-1 text-[9px] leading-4 text-muted">Median error across all graded projections.</p>
                            </div>
                            <div className="rounded-xl border bg-surface p-3">
                              <p className="text-[8px] uppercase tracking-[0.08em] text-faint">30% recent miss</p>
                              <p className="mt-1 text-lg font-semibold tabular">{row.recentMedianAbsoluteError.toFixed(1)} {unit}</p>
                              <p className="mt-1 text-[9px] leading-4 text-muted">Median error from the latest 40 graded rows.</p>
                            </div>
                            <div className="rounded-xl border bg-surface p-3">
                              <p className="text-[8px] uppercase tracking-[0.08em] text-faint">20% bad-day penalty</p>
                              <p className="mt-1 text-lg font-semibold tabular">{row.p90AbsoluteError.toFixed(1)} {unit}</p>
                              <p className="mt-1 text-[9px] leading-4 text-muted">90th-percentile error, so repeated ugly misses still matter.</p>
                            </div>
                          </div>
                          <div className="mt-3 rounded-xl border bg-surface-raised/45 p-3">
                            <p className="text-[9px] uppercase tracking-[0.08em] text-faint">With the real numbers</p>
                            <p className="mt-1 text-sm font-semibold tabular">{formula}</p>
                            <p className="mt-2 text-[10px] leading-4 text-muted">
                              The simple average absolute miss is {row.meanAbsoluteError.toFixed(1)} {unit}. Huddlemark uses the robust {row.robustError.toFixed(1)} {unit} score instead so one freak projection cannot dominate the source.
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
                            How that becomes influence
                          </p>
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2.5">
                              <span className="text-[10px] text-muted">Equal starting share</span>
                              <span className="text-xs font-semibold tabular">{(100 / Math.max(playerSourceCount, 1)).toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2.5">
                              <span className="text-[10px] text-muted">Accuracy target share</span>
                              <span className="text-xs font-semibold tabular">{(row.learnedTarget * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2.5">
                              <span className="text-[10px] text-muted">Learning confidence</span>
                              <span className="text-xs font-semibold tabular">{(row.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-accent/25 bg-accent-bg/40 px-3 py-2.5">
                              <span className="text-[10px] font-semibold">Current model influence</span>
                              <span className="text-sm font-semibold tabular text-accent">{row.weight === null ? "Waiting" : `${(row.weight * 100).toFixed(1)}%`}</span>
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="flex items-end justify-between gap-3">
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
                                  Weight by NFL week
                                </p>
                                <p className="mt-1 text-[9px] leading-4 text-muted">
                                  Each value is the influence used for that week. It is learned only from games completed before that week begins.
                                </p>
                              </div>
                            </div>
                            <div className="scrollbar-subtle mt-2 flex gap-2 overflow-x-auto pb-1">
                              {[
                                { label: "Start", weight: row.baselineWeight, delta: null as number | null },
                                ...row.weightHistory.map((point, pointIndex) => {
                                  const prior =
                                    pointIndex === 0
                                      ? row.baselineWeight
                                      : row.weightHistory[pointIndex - 1]?.weight ?? row.baselineWeight;
                                  return {
                                    label: `W${point.week}`,
                                    weight: point.weight,
                                    delta: point.weight - prior,
                                  };
                                }),
                              ].map((point) => (
                                <div
                                  key={point.label}
                                  className="min-w-[92px] rounded-xl border bg-surface px-3 py-2.5"
                                >
                                  <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-faint">
                                    {point.label}
                                  </p>
                                  <p className="mt-1 text-sm font-semibold tabular">
                                    {(point.weight * 100).toFixed(1)}%
                                  </p>
                                  <p className={cn(
                                    "mt-0.5 text-[8px] tabular",
                                    point.delta === null || Math.abs(point.delta) < 0.0005
                                      ? "text-faint"
                                      : point.delta > 0
                                        ? "text-positive"
                                        : "text-negative",
                                  )}>
                                    {point.delta === null
                                      ? "Equal baseline"
                                      : `${point.delta > 0 ? "+" : ""}${(point.delta * 100).toFixed(1)} pp`}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <p className="mt-3 text-[9px] leading-4 text-faint">
                            Accuracy strength is 1 ÷ typical miss. The source is then shrunk toward an equal share until it has enough graded rows. Learning confidence starts at 0% through 20 grades and reaches its 75% cap at 155 graded rows.
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 border-t pt-4">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">Real graded examples</p>
                            <p className="mt-1 text-[10px] text-muted">These are actual saved projections compared with the final box score.</p>
                          </div>
                          <span className="text-[9px] text-faint">Most recent first</span>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          {row.examples.length ? row.examples.map((example) => (
                            <div key={`${example.playerName}:${example.week}:${example.projectedValue}:${example.actualValue}`} className="rounded-xl border bg-surface p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-semibold">{example.playerName}</p>
                                <span className="shrink-0 text-[8px] uppercase tracking-[0.08em] text-faint">Wk {example.week}</span>
                              </div>
                              <div className="mt-3 flex items-end justify-between gap-2">
                                <div>
                                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">Projected</p>
                                  <p className="mt-0.5 text-sm font-semibold tabular">{example.projectedValue.toFixed(1)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">Actual</p>
                                  <p className="mt-0.5 text-sm font-semibold tabular">{example.actualValue.toFixed(1)}</p>
                                </div>
                              </div>
                              <div className="mt-2 rounded-lg bg-background px-2.5 py-2 text-center">
                                <span className="text-[9px] text-muted">Miss </span>
                                <span className="text-xs font-semibold tabular">{example.absoluteError.toFixed(1)} {unit}</span>
                              </div>
                            </div>
                          )) : (
                            <p className="text-xs text-muted">No individual graded examples available yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="px-5 py-12 text-center">
              <p className="font-medium">No settled grades for this stat yet.</p>
              <p className="mt-1 text-xs text-muted">The source remains visible, but it earns no learned advantage until games finish.</p>
            </div>
          )}
        </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3" aria-label="How source learning works">
        {[
          ["01", "Freeze", "Save every source projection before kickoff so hindsight cannot rewrite it."],
          ["02", "Grade", "Compare the saved number with the official final player stat."],
          ["03", "Reweight", "Reward repeatable accuracy and reduce influence when a source keeps missing."],
        ].map(([number, title, copy]) => (
          <div key={number} className="rounded-2xl border bg-surface p-5">
            <span className="text-[10px] font-bold text-accent">{number}</span>
            <h3 className="mt-4 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-xs leading-5 text-muted">{copy}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
