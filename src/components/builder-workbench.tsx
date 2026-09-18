"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Layers3,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import {
  buildBestAvailableCombination,
  type BuilderMode,
  type BuilderObjective,
} from "@/lib/builder";
import { isBuilderEligibleOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatEdge, formatPercent } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";
import { useMarketData } from "./market-data-provider";

function builderPickLabel(market: MarketOpportunity) {
  const canonical = market.canonical;
  const threshold = canonical?.threshold;
  const direction = canonical?.direction;

  if (!canonical || threshold === null || threshold === undefined || !direction) {
    return market.recommendedSide === "no"
      ? `NO: ${market.marketTitle}`
      : market.marketTitle;
  }

  const takingContract = market.recommendedSide !== "no";
  const pickDirection = takingContract
    ? direction
    : direction === "over"
      ? "under"
      : "over";
  const label =
    canonical.family === "receiving_yards"
      ? "receiving yards"
      : canonical.family === "rushing_yards"
        ? "rushing yards"
        : canonical.family === "passing_yards"
          ? "passing yards"
          : canonical.family === "receptions"
            ? "receptions"
            : canonical.family === "passing_touchdowns"
              ? "passing TDs"
              : canonical.family === "touchdowns"
                ? "TDs"
                : canonical.family.replaceAll("_", " ");

  return `${canonical.subject}: ${pickDirection === "over" ? "Over" : "Under"} ${threshold} ${label}`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

function SegmentedButton<T extends string>({
  value,
  current,
  onClick,
  title,
  description,
  icon,
}: {
  value: T;
  current: T;
  onClick: (value: T) => void;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  const active = value === current;

  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "group rounded-xl border p-3 text-left transition-all",
        active
          ? "border-strong bg-foreground text-background shadow-sm"
          : "bg-surface hover:border-strong hover:bg-surface-raised",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-7 place-items-center rounded-lg border",
            active
              ? "border-background/20 bg-background/10"
              : "bg-surface-raised text-muted",
          )}
        >
          {icon}
        </span>
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <p
        className={cn(
          "mt-2 text-[10px] leading-4",
          active ? "text-background/70" : "text-muted",
        )}
      >
        {description}
      </p>
    </button>
  );
}

const RETURN_PRESETS = [
  { label: "2x to 3x", min: 2, max: 3 },
  { label: "3x to 5x", min: 3, max: 5 },
  { label: "5x to 10x", min: 5, max: 10 },
  { label: "10x to 20x", min: 10, max: 20 },
] as const;

function legOddsContribution(
  leg: MarketOpportunity,
  legs: MarketOpportunity[],
) {
  const contribution = -Math.log(
    Math.max((leg.executablePriceBps ?? 1) / 10_000, 0.001),
  );
  const total = legs.reduce(
    (sum, row) =>
      sum -
      Math.log(Math.max((row.executablePriceBps ?? 1) / 10_000, 0.001)),
    0,
  );
  return total > 0 ? contribution / total : 0;
}

function balanceLabel(score: number) {
  if (score >= 0.82) return "Well distributed";
  if (score >= 0.68) return "Slightly focused";
  return "Concentrated";
}

export function BuilderWorkbench() {
  const { opportunities, loading } = useMarketData();
  const currentMarkets = useMemo(
    () => opportunities.filter(isBuilderEligibleOpportunity),
    [opportunities],
  );

  const [minReturn, setMinReturn] = useState(3);
  const [maxReturn, setMaxReturn] = useState(6);
  const [maxLegs, setMaxLegs] = useState(5);
  const [platform, setPlatform] = useState<
    "either" | "kalshi" | "polymarket"
  >("either");
  const [live, setLive] = useState<"all" | "pregame" | "live">("pregame");
  const [mode, setMode] = useState<BuilderMode>("multi_game");
  const [objective, setObjective] = useState<BuilderObjective>("balanced");
  const [stake, setStake] = useState(100);

  const combination = useMemo(
    () =>
      buildBestAvailableCombination(currentMarkets, {
        minReturn,
        maxReturn,
        maxLegs,
        platform,
        live,
        mode,
        objective,
      }),
    [
      currentMarkets,
      live,
      maxLegs,
      maxReturn,
      minReturn,
      mode,
      objective,
      platform,
    ],
  );

  const payout = combination ? combination.grossReturn * stake : 0;
  const profit = combination ? payout - stake : 0;
  const evProfit = combination
    ? (combination.expectedProfitOn100 * stake) / 100
    : 0;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.035)]">
        <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Build setup</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Pick the structure first, then tell Lynerva what kind of build
                you want.
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted sm:mt-0">
              <span className="size-1.5 rounded-full bg-positive" />
              {currentMarkets.length.toLocaleString()} eligible live markets
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1.08fr_1fr]">
          <div>
            <FieldLabel>Build type</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-3">
              <SegmentedButton
                value="multi_game"
                current={mode}
                onClick={setMode}
                title="Cross-game"
                description="One leg per matchup. Cleaner independence."
                icon={<Layers3 className="size-3.5" />}
              />
              <SegmentedButton
                value="sgp"
                current={mode}
                onClick={setMode}
                title="Same game"
                description="SGP mode. One matchup and one platform."
                icon={<Target className="size-3.5" />}
              />
              <SegmentedButton
                value="any"
                current={mode}
                onClick={setMode}
                title="Any mix"
                description="Let the optimizer use either structure."
                icon={<Sparkles className="size-3.5" />}
              />
            </div>

            <div className="mt-5">
              <FieldLabel>Build style</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-3">
                <SegmentedButton
                  value="balanced"
                  current={objective}
                  onClick={setObjective}
                  title="Balanced"
                  description="Best mix of hit rate, value, and payout shape."
                  icon={<BarChart3 className="size-3.5" />}
                />
                <SegmentedButton
                  value="safer"
                  current={objective}
                  onClick={setObjective}
                  title="Safer"
                  description="Lean harder toward the highest hit chance."
                  icon={<ShieldCheck className="size-3.5" />}
                />
                <SegmentedButton
                  value="max_ev"
                  current={objective}
                  onClick={setObjective}
                  title="Max EV"
                  description="Lean harder toward underpriced combinations."
                  icon={<Zap className="size-3.5" />}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-background/60 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold">Return target</p>
                <p className="mt-0.5 text-[10px] text-muted">
                  Target range, not an exact payout.
                </p>
              </div>
              <div className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-medium tabular">
                {minReturn.toFixed(1)}x to {maxReturn.toFixed(1)}x
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {RETURN_PRESETS.map((preset) => {
                const active =
                  minReturn === preset.min && maxReturn === preset.max;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setMinReturn(preset.min);
                      setMaxReturn(preset.max);
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-2 text-[11px] font-medium transition-colors",
                      active
                        ? "border-strong bg-foreground text-background"
                        : "bg-surface hover:bg-surface-raised",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label>
                <FieldLabel>Minimum</FieldLabel>
                <div className="flex h-10 items-center rounded-lg border bg-surface px-3">
                  <input
                    type="number"
                    min="1.1"
                    max="50"
                    step="0.5"
                    value={minReturn}
                    onChange={(event) =>
                      setMinReturn(Math.max(1.1, Number(event.target.value)))
                    }
                    className="w-full bg-transparent text-sm outline-none tabular"
                  />
                  <span className="text-xs text-muted">x</span>
                </div>
              </label>

              <label>
                <FieldLabel>Maximum</FieldLabel>
                <div className="flex h-10 items-center rounded-lg border bg-surface px-3">
                  <input
                    type="number"
                    min={minReturn}
                    max="100"
                    step="0.5"
                    value={maxReturn}
                    onChange={(event) =>
                      setMaxReturn(
                        Math.max(minReturn, Number(event.target.value)),
                      )
                    }
                    className="w-full bg-transparent text-sm outline-none tabular"
                  />
                  <span className="text-xs text-muted">x</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t bg-surface-raised/50 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
          <label>
            <FieldLabel>Max legs</FieldLabel>
            <select
              value={maxLegs}
              onChange={(event) => setMaxLegs(Number(event.target.value))}
              className="h-10 w-full rounded-lg border bg-surface px-3 text-xs outline-none"
            >
              <option value="2">2 legs</option>
              <option value="3">3 legs</option>
              <option value="4">4 legs</option>
              <option value="5">5 legs</option>
              <option value="6">6 legs</option>
            </select>
          </label>

          <label>
            <FieldLabel>Platform</FieldLabel>
            <select
              value={platform}
              onChange={(event) =>
                setPlatform(event.target.value as typeof platform)
              }
              className="h-10 w-full rounded-lg border bg-surface px-3 text-xs outline-none"
            >
              <option value="either">Either platform</option>
              <option value="kalshi">Kalshi only</option>
              <option value="polymarket">Polymarket only</option>
            </select>
          </label>

          <label>
            <FieldLabel>Market state</FieldLabel>
            <select
              value={live}
              onChange={(event) => setLive(event.target.value as typeof live)}
              className="h-10 w-full rounded-lg border bg-surface px-3 text-xs outline-none"
            >
              <option value="pregame">Pregame only</option>
              <option value="live">Live only</option>
              <option value="all">Pregame + live</option>
            </select>
          </label>

          <label>
            <FieldLabel>Stake</FieldLabel>
            <div className="flex h-10 items-center rounded-lg border bg-surface px-3">
              <span className="text-xs text-muted">$</span>
              <input
                type="number"
                min="1"
                max="100000"
                step="10"
                value={stake}
                onChange={(event) =>
                  setStake(Math.max(1, Number(event.target.value)))
                }
                className="w-full bg-transparent pl-1 text-sm outline-none tabular"
              />
            </div>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.035)]">
        {loading && currentMarkets.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
              <Sparkles className="size-4 text-muted" />
            </div>
            <p className="font-medium">Loading live picks...</p>
            <p className="mt-1 text-xs text-muted">
              The builder will update as soon as the market snapshot arrives.
            </p>
          </div>
        ) : !combination ? (
          <div className="px-6 py-20 text-center">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
              <Target className="size-4 text-muted" />
            </div>
            <p className="font-medium">No build fits this setup</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">
              Widen the return range, allow more legs, change the platform, or
              switch between cross-game and same-game mode.
            </p>
          </div>
        ) : (
          <>
            <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {mode === "sgp"
                        ? "Same game parlay"
                        : mode === "multi_game"
                          ? "Cross-game build"
                          : "Smart build"}
                    </span>
                    <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-medium text-muted">
                      {objective === "balanced"
                        ? "Balanced"
                        : objective === "safer"
                          ? "Safer"
                          : "Max EV"}
                    </span>
                  </div>

                  <p className="mt-3 text-2xl font-semibold tracking-[-0.035em] tabular sm:text-3xl">
                    {"$"}{stake.toLocaleString()} to about {"$"}{Math.round(payout).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    About {"$"}{Math.round(profit).toLocaleString()} profit at the
                    current market prices.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
                  <div className="rounded-xl border bg-surface p-3">
                    <p className="text-[10px] text-faint">Est. hit chance</p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {formatPercent(
                        Math.round(combination.estimatedProbability * 10_000),
                        1,
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-surface p-3">
                    <p className="text-[10px] text-faint">Market chance</p>
                    <p className="mt-1 text-lg font-semibold tabular">
                      {formatPercent(
                        Math.round(combination.impliedProbability * 10_000),
                        1,
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-surface p-3">
                    <p className="text-[10px] text-faint">Expected profit</p>
                    <p
                      className={cn(
                        "mt-1 text-lg font-semibold tabular",
                        evProfit >= 0 ? "text-positive" : "text-negative",
                      )}
                    >
                      {evProfit >= 0 ? "+" : ""}{"$"}{Math.round(evProfit)}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-surface p-3">
                    <p className="text-[10px] text-faint">Payout shape</p>
                    <p className="mt-1 text-sm font-semibold">
                      {balanceLabel(combination.balanceScore)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <ol className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
              {combination.legs.map((leg, index) => {
                const contribution = legOddsContribution(
                  leg,
                  combination.legs,
                );
                const matchup =
                  leg.canonical?.matchup ?? leg.eventTitle ?? "NFL";
                return (
                  <li
                    key={`${leg.platform}:${leg.platformMarketId}`}
                    className="rounded-xl border bg-surface-raised/35 p-4 transition-colors hover:bg-surface-raised"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg border bg-surface text-[10px] font-semibold text-muted">
                        {index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                          {matchup}
                        </p>
                        <p className="mt-1 text-sm font-semibold leading-5">
                          {builderPickLabel(leg)}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <PlatformMark platform={leg.platform} />
                          <span className="rounded-full border bg-surface px-2 py-0.5 text-[9px] font-semibold">
                            Score {leg.lynervaScore ?? "n/a"}
                          </span>
                          <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[9px] font-semibold text-positive">
                            {formatEdge(
                              (leg.recommendedProbabilityBps ?? 0) -
                                (leg.executablePriceBps ?? 0),
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular">
                          {formatPercent(leg.executablePriceBps)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted tabular">
                          Model {formatPercent(leg.recommendedProbabilityBps)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-[9px] text-faint">
                        <span>Payout contribution</span>
                        <span className="tabular">
                          {Math.round(contribution * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background">
                        <div
                          className="h-full rounded-full bg-foreground/70 transition-[width]"
                          style={{
                            width: `${Math.max(4, contribution * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="grid gap-3 border-t bg-surface-raised/55 px-4 py-4 sm:px-5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="text-[11px] leading-5 text-muted">
                <strong className="font-semibold text-foreground">
                  The builder now scores the whole combination.
                </strong>{" "}
                It weighs hit rate, expected value, target payout, and how much
                each leg contributes to the final odds. One longshot can still
                be used when its model edge is unusually strong, but ordinary
                builds are penalized when one leg carries most of the payout.
                {combination.correlationWarning
                  ? " Same-game legs may be correlated, so the displayed combined chance is only an approximation."
                  : ""}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted">
                <span className="rounded-full border bg-surface px-2.5 py-1 tabular">
                  {combination.legs.length} legs
                </span>
                <ArrowRight className="size-3.5" />
                <span className="rounded-full border bg-surface px-2.5 py-1 tabular">
                  {combination.grossReturn.toFixed(2)}x
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
