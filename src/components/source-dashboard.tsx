"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
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
  medianAbsoluteError: number;
  p90AbsoluteError: number;
  recentMedianAbsoluteError: number;
  robustError: number;
  rmse: number;
  bias: number;
  weight: number | null;
  previousWeight: number | null;
  weightChange: number | null;
  weightWeek: number | null;
};

type SourceSummary = {
  id: string;
  name: string;
  kind: string;
  href: string;
  access: string;
  note: string;
  coverageCount: number;
  lastCapturedAt: string | null;
  lastGradedAt: string | null;
};

const STAT_LABELS: Record<string, string> = {
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
  if (row.weightChange === null || Math.abs(row.weightChange) < 0.002) {
    return { label: "No weight change", Icon: Minus, tone: "text-faint" };
  }
  if (row.weightChange > 0) {
    return {
      label: `Influence +${(row.weightChange * 100).toFixed(1)}%`,
      Icon: TrendingUp,
      tone: "text-positive",
    };
  }
  return {
    label: `Influence ${(row.weightChange * 100).toFixed(1)}%`,
    Icon: TrendingDown,
    tone: "text-negative",
  };
}

export function SourceDashboard({
  season,
  coverageWeek,
  rows,
  sources,
  generatedAt,
}: {
  season: number;
  coverageWeek: number | null;
  rows: PerformanceRow[];
  sources: SourceSummary[];
  generatedAt: string;
}) {
  const stats = useMemo(
    () =>
      [...new Set(rows.map((row) => row.statistic))].toSorted((a, b) =>
        statLabel(a).localeCompare(statLabel(b)),
      ),
    [rows],
  );
  const [selectedStat, setSelectedStat] = useState(stats[0] ?? "passing_yards");
  const selectedRows = rows
    .filter((row) => row.statistic === selectedStat)
    .toSorted(
      (first, second) =>
        first.robustError - second.robustError ||
        second.sampleSize - first.sampleSize,
    );

  const totalGrades = rows.reduce((sum, row) => sum + row.sampleSize, 0);
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
              When the numbers last moved
            </h2>
          </div>
          <p className="text-xs text-muted">Times come from successful database writes.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border bg-surface p-5">
            <div className="flex items-center gap-2 text-accent">
              <Database className="size-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Projection capture</span>
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
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sources.map((source) => {
            const sourceRows = rows.filter((row) => row.source === source.id);
            const graded = sourceRows.reduce((sum, row) => sum + row.sampleSize, 0);
            const best = sourceRows.toSorted(
              (a, b) => a.robustError - b.robustError,
            )[0];
            return (
              <article key={source.id} className="group rounded-2xl border bg-surface p-5 transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background text-sm font-bold text-accent">
                      {source.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{source.name}</h3>
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
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">This week</p>
                    <p className="mt-1 text-sm font-semibold tabular">{source.coverageCount}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Graded</p>
                    <p className="mt-1 text-sm font-semibold tabular">{graded.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Best at</p>
                    <p className="mt-1 truncate text-sm font-semibold">{best ? statLabel(best.statistic) : "Waiting"}</p>
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
              “Typical miss” is the blended error Huddlemark uses to judge consistency. Lower is better. Influence changes only after real results are graded.
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
              return (
                <div key={`${row.source}:${row.statistic}`} className="grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[1.2fr_0.7fr_0.8fr_0.9fr] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                      index === 0 ? "bg-positive-bg text-positive" : "bg-background text-muted",
                    )}>
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{source?.name ?? row.source}</p>
                      {index === 0 ? <p className="text-[9px] text-positive">Lowest error so far</p> : null}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Graded</p>
                    <p className="text-sm font-semibold tabular">{row.sampleSize.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Typical miss</p>
                    <p className="text-sm font-semibold tabular">{row.robustError.toFixed(1)} {errorUnit(row.statistic)}</p>
                    <p className="text-[9px] text-faint">Bias {row.bias >= 0 ? "+" : ""}{row.bias.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.08em] text-faint sm:hidden">Model influence</p>
                    <p className="text-sm font-semibold tabular">{row.weight === null ? "Waiting" : `${(row.weight * 100).toFixed(1)}%`}</p>
                    <p className={cn("mt-0.5 inline-flex items-center gap-1 text-[9px]", rowTrend.tone)}>
                      <TrendIcon className="size-3" />
                      {rowTrend.label}
                    </p>
                  </div>
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
