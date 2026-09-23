"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ReceiptText,
  ShieldCheck,
  X,
} from "lucide-react";
import type { WeeklyScorecard } from "@/lib/model/scorecard";
import { cn } from "@/lib/utils";

function percent(value: number) {
  return `${(value / 100).toFixed(1)}%`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "exceptZero",
  }).format(value);
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function EquityCurve({ week }: { week: WeeklyScorecard }) {
  const settled = week.picks.filter(
    (pick) => pick.profitOnTen !== null,
  );
  if (!settled.length) {
    return (
      <div className="grid min-h-44 place-items-center rounded-2xl border bg-background p-6 text-center">
        <div>
          <Clock3 className="mx-auto size-5 text-muted" />
          <p className="mt-3 text-sm font-semibold">Waiting for final results</p>
          <p className="mt-1 text-xs text-muted">The line appears as picks settle.</p>
        </div>
      </div>
    );
  }

  const cumulative = [0];
  for (const pick of settled) {
    cumulative.push(cumulative.at(-1)! + (pick.profitOnTen ?? 0));
  }
  const minimum = Math.min(...cumulative, 0);
  const maximum = Math.max(...cumulative, 0);
  const range = Math.max(1, maximum - minimum);
  const points = cumulative
    .map((value, index) => {
      const x = (index / Math.max(1, cumulative.length - 1)) * 100;
      const y = 82 - ((value - minimum) / range) * 64;
      return `${x},${y}`;
    })
    .join(" ");
  const positive = cumulative.at(-1)! >= 0;

  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">Hypothetical bankroll</p>
          <p className="mt-1 text-xs text-muted">$10 on every settled pick</p>
        </div>
        <p className={cn("text-xl font-semibold tabular", positive ? "text-positive" : "text-negative")}>
          {money(week.profitOnTen)}
        </p>
      </div>
      <svg
        viewBox="0 0 100 92"
        preserveAspectRatio="none"
        className="mt-4 h-36 w-full overflow-visible"
        role="img"
        aria-label={`Cumulative hypothetical profit ${money(week.profitOnTen)}`}
      >
        <line x1="0" x2="100" y1={82 - ((0 - minimum) / range) * 64} y2={82 - ((0 - minimum) / range) * 64} stroke="var(--border)" strokeWidth="0.7" />
        <polyline
          fill="none"
          stroke={positive ? "var(--positive)" : "var(--negative)"}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={points}
        />
      </svg>
    </div>
  );
}

export function ResultsDashboard({ weeks }: { weeks: WeeklyScorecard[] }) {
  const [selectedKey, setSelectedKey] = useState(weeks[0]?.key ?? "");
  const selectedIndex = Math.max(
    0,
    weeks.findIndex((week) => week.key === selectedKey),
  );
  const week = weeks[selectedIndex];
  const record = week ? `${week.hits}–${week.misses}` : "—";
  const settledRate = week?.settled
    ? week.hits / week.settled
    : 0;
  const evidenceCopy = useMemo(() => {
    if (!week || week.settled === 0) return "Nothing is being counted before the answer exists.";
    if (week.settled < week.picks.length) {
      return `${week.picks.length - week.settled} pick${week.picks.length - week.settled === 1 ? "" : "s"} still waiting. ROI uses settled picks only.`;
    }
    return "Every pick on this card has a final result.";
  }, [week]);

  if (!week) {
    return (
      <div className="space-y-6">
        <section className="results-hero rounded-[28px] border bg-surface p-6 sm:p-10">
          <div className="grid size-11 place-items-center rounded-2xl border bg-background text-accent">
            <ReceiptText className="size-5" />
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            The receipts will live here.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
            Huddlemark has not settled a frozen pregame scorecard yet. Locked picks are checked directly against Kalshi settlement data, and this page rechecks unresolved picks when it loads.
          </p>
        </section>
        <div className="rounded-2xl border bg-surface p-5 text-xs leading-5 text-muted">
          No cherry-picked demo data is shown. This page stays empty until real, timestamped predictions receive real outcomes.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="results-hero overflow-hidden rounded-[28px] border bg-surface p-5 sm:p-8 lg:p-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              <ShieldCheck className="size-3.5 text-positive" />
              Frozen before the result
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
              How did the model actually do?
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              Every week locks a balanced pregame card: 1 TNF, 4 Sunday noon, 3 Sunday late, 1 SNF, and 1 MNF. Each slate freezes five minutes before its kickoff window.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedIndex >= weeks.length - 1}
              onClick={() => setSelectedKey(weeks[selectedIndex + 1]!.key)}
              className="grid size-10 place-items-center rounded-xl border bg-background text-muted disabled:opacity-30"
              aria-label="Older week"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="min-w-36 rounded-xl border bg-background px-4 py-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.1em] text-faint">Scorecard</p>
              <p className="mt-0.5 text-sm font-semibold">{week.label}</p>
            </div>
            <button
              type="button"
              disabled={selectedIndex === 0}
              onClick={() => setSelectedKey(weeks[selectedIndex - 1]!.key)}
              className="grid size-10 place-items-center rounded-xl border bg-background text-muted disabled:opacity-30"
              aria-label="Newer week"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Weekly scorecard summary">
        {[
          ["Record", record, week.settled ? settledRate : null],
          ["Settled", `${week.settled}/${week.picks.length}`, null],
          ["Profit", money(week.profitOnTen), week.profitOnTen],
          ["ROI", week.settled ? `${(week.roi * 100).toFixed(1)}%` : "Waiting", week.settled ? week.roi : null],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-2xl border bg-surface p-4 sm:p-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</p>
            <p className={cn(
              "mt-3 text-2xl font-semibold tabular sm:text-3xl",
              typeof tone === "number" && tone > 0 ? "text-positive" : "",
              typeof tone === "number" && tone < 0 ? "text-negative" : "",
            )}>
              {value}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <EquityCurve week={week} />
        <div className="rounded-2xl border bg-surface p-5">
          <p className="eyebrow">What this means</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
            A result, not a victory lap
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">{evidenceCopy}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-background p-4">
              <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Profit rule</p>
              <p className="mt-2 text-xs leading-5">A fixed $10 at the frozen executable price. No hindsight sizing.</p>
            </div>
            <div className="rounded-xl bg-background p-4">
              <p className="text-[9px] uppercase tracking-[0.08em] text-faint">Selection rule</p>
              <p className="mt-2 text-xs leading-5">1 TNF, 4 Sunday noon, 3 Sunday late, 1 SNF, and 1 MNF. Each slate locks five minutes before its first kickoff, then never changes.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="eyebrow">The full card</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Every pick stays visible.</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {week.picks.map((pick) => (
            <article key={pick.id} className="rounded-2xl border bg-surface p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-background text-xs font-bold">{pick.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border bg-background px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted">
                      {pick.slot}
                    </span>
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em]",
                      pick.result === "hit"
                        ? "bg-positive-bg text-positive"
                        : pick.result === "miss"
                          ? "bg-negative-bg text-negative"
                          : "bg-background text-muted",
                    )}>
                      {pick.result === "hit" ? <Check className="size-3" /> : pick.result === "miss" ? <X className="size-3" /> : <Clock3 className="size-3" />}
                      {pick.result}
                    </span>
                    <span className="text-[9px] text-faint">Frozen {shortTime(pick.frozenAt)}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-5">{pick.title}</h3>
                  <p className="mt-1 truncate text-[10px] text-faint">{pick.context}</p>
                </div>
                <div className="text-right">
                  <p className={cn(
                    "text-sm font-semibold tabular",
                    (pick.profitOnTen ?? 0) > 0 ? "text-positive" : "",
                    (pick.profitOnTen ?? 0) < 0 ? "text-negative" : "",
                  )}>
                    {pick.profitOnTen === null ? "—" : money(pick.profitOnTen)}
                  </p>
                  <p className="mt-1 text-[8px] uppercase tracking-[0.08em] text-faint">$10 stake</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-background p-3">
                <div>
                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">Model</p>
                  <p className="mt-1 text-xs font-semibold tabular">{percent(pick.probabilityBps)}</p>
                </div>
                <div>
                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">Price</p>
                  <p className="mt-1 text-xs font-semibold tabular">{percent(pick.executablePriceBps)}</p>
                </div>
                <div>
                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">Score</p>
                  <p className="mt-1 text-xs font-semibold tabular">{pick.score.toFixed(0)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="rounded-2xl border bg-surface p-4 text-[11px] leading-5 text-muted">
        Hypothetical returns exclude taxes and assume the frozen ask was fillable for $10. This is a model audit, not a promise of profit or a recommendation to wager.
      </p>
    </div>
  );
}
