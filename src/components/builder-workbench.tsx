"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  FlaskConical,
  Layers3,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
  Zap,
} from "lucide-react";
import {
  buildRankedCombinations,
  buildTopScoredCombinations,
  type BuilderMode,
  type BuilderObjective,
} from "@/lib/builder";
import {
  buildPortfolioPlan,
  type PortfolioRisk,
} from "@/lib/builder/portfolio";
import { isBuilderEligibleOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatEdge, formatPercent } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";
import { useMarketData } from "./market-data-provider";
import { BetLab } from "./market-table";
import { SubjectVisual } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

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
            : canonical.family === "passing_interceptions"
              ? "interceptions"
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
        "group rounded-xl border p-2.5 text-left transition-all sm:p-3",
        active
          ? "border-accent/40 bg-accent-bg text-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
          : "bg-surface hover:border-strong hover:bg-surface-raised",
      )}
    >
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-lg border sm:size-7",
            active
              ? "border-accent/25 bg-accent/10 text-accent"
              : "bg-surface-raised text-muted",
          )}
        >
          {icon}
        </span>
        <span className="text-[10px] font-semibold leading-4 sm:text-xs">{title}</span>
      </div>
      <p
        className={cn(
          "mt-2 hidden text-[10px] leading-4 sm:block",
          active ? "text-accent/80" : "text-muted",
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

function builderScoreTone(score: number | null | undefined) {
  if ((score ?? 0) >= 72) return "builder-card-good";
  if ((score ?? 0) >= 52) return "builder-card-watch";
  return "builder-card-low";
}

function builderScoreLabel(score: number | null | undefined) {
  if ((score ?? 0) >= 80) return "Elite";
  if ((score ?? 0) >= 72) return "Strong";
  if ((score ?? 0) >= 60) return "Solid";
  if ((score ?? 0) >= 52) return "Watch";
  return "Thin";
}

function portfolioRoleLabel(
  role:
    | "core_straight"
    | "value_straight"
    | "aggressive_straight"
    | "core_parlay"
    | "upside_parlay"
    | "hail_mary",
  parlayMode: "multi_game" | "sgp" | null,
) {
  if (role === "core_straight") return "Core straight";
  if (role === "value_straight") return "Value straight";
  if (role === "aggressive_straight") return "Aggressive straight";
  if (role === "core_parlay") {
    return parlayMode === "sgp" ? "Core SGP" : "Core parlay";
  }
  if (role === "upside_parlay") {
    return parlayMode === "sgp" ? "Upside SGP" : "Upside parlay";
  }
  return parlayMode === "sgp" ? "Hail Mary SGP" : "Hail Mary parlay";
}

export function BuilderWorkbench() {
  const { opportunities, loading } = useMarketData();
  const currentMarkets = useMemo(
    () => opportunities.filter(isBuilderEligibleOpportunity),
    [opportunities],
  );

  type ParlayRequest = {
    markets: MarketOpportunity[];
    minReturn: number;
    maxReturn: number;
    maxLegs: number;
    platform: "either" | "kalshi" | "polymarket";
    live: "all" | "pregame" | "live";
    mode: BuilderMode;
    objective: BuilderObjective;
    stake: number;
  };

  type PortfolioRequest = {
    markets: MarketOpportunity[];
    amount: number;
    targetPayout: number;
    risk: PortfolioRisk;
    platform: "either" | "kalshi" | "polymarket";
    live: "all" | "pregame" | "live";
    mode: BuilderMode;
    maxLegs: number;
  };

  const [minReturnInput, setMinReturnInput] = useState("3");
  const [maxReturnInput, setMaxReturnInput] = useState("6");
  const [maxLegs, setMaxLegs] = useState(6);
  const [platform, setPlatform] = useState<
    "either" | "kalshi" | "polymarket"
  >("either");
  const [live, setLive] = useState<"all" | "pregame" | "live">("pregame");
  const [mode, setMode] = useState<BuilderMode>("multi_game");
  const [objective, setObjective] = useState<BuilderObjective>("balanced");
  const [stakeInput, setStakeInput] = useState("100");
  const [builderView, setBuilderView] = useState<"parlay" | "portfolio">("parlay");
  const [planAmountInput, setPlanAmountInput] = useState("100");
  const [targetPayoutInput, setTargetPayoutInput] = useState("250");
  const [portfolioRisk, setPortfolioRisk] =
    useState<PortfolioRisk>("balanced");
  const [parlayRequest, setParlayRequest] =
    useState<ParlayRequest | null>(null);
  const [portfolioRequest, setPortfolioRequest] =
    useState<PortfolioRequest | null>(null);
  const [selectedMarket, setSelectedMarket] =
    useState<MarketOpportunity | null>(null);
  const [rankingMode, setRankingMode] = useState(false);
  const [activeParlayIndex, setActiveParlayIndex] = useState(0);

  const minReturnNumber = Number(minReturnInput);
  const maxReturnNumber = Number(maxReturnInput);
  const stakeNumber = Number(stakeInput);
  const planAmountNumber = Number(planAmountInput);
  const targetPayoutNumber = Number(targetPayoutInput);

  const canBuildParlay =
    Number.isFinite(minReturnNumber) &&
    Number.isFinite(maxReturnNumber) &&
    Number.isFinite(stakeNumber) &&
    minReturnNumber > 1 &&
    maxReturnNumber >= minReturnNumber &&
    maxReturnNumber <= 100 &&
    stakeNumber > 0;

  const canBuildPortfolio =
    Number.isFinite(planAmountNumber) &&
    Number.isFinite(targetPayoutNumber) &&
    planAmountNumber > 0 &&
    targetPayoutNumber > planAmountNumber;

  const draftTargetReturn = canBuildPortfolio
    ? targetPayoutNumber / planAmountNumber
    : null;

  const combinations = useMemo(() => {
    if (!parlayRequest) return [];
    if (rankingMode) {
      return buildTopScoredCombinations(parlayRequest.markets, 10);
    }
    return buildRankedCombinations(
      parlayRequest.markets,
      {
        minReturn: parlayRequest.minReturn,
        maxReturn: parlayRequest.maxReturn,
        maxLegs: parlayRequest.maxLegs,
        platform: parlayRequest.platform,
        live: parlayRequest.live,
        mode: parlayRequest.mode,
        objective: parlayRequest.objective,
      },
      6,
    );
  }, [parlayRequest, rankingMode]);

  const combination =
    combinations[activeParlayIndex] ?? combinations[0] ?? null;

  const portfolioPlan = useMemo(() => {
    if (!portfolioRequest) return null;
    return buildPortfolioPlan(portfolioRequest.markets, {
      amount: portfolioRequest.amount,
      targetPayout: portfolioRequest.targetPayout,
      risk: portfolioRequest.risk,
      platform: portfolioRequest.platform,
      live: portfolioRequest.live,
      mode: portfolioRequest.mode,
      maxLegs: portfolioRequest.maxLegs,
    });
  }, [portfolioRequest]);

  const resultPlayerNames = useMemo(
    () =>
      [
        ...(combination?.legs ?? []),
        ...(portfolioPlan?.positions.flatMap((position) => position.legs) ?? []),
      ]
        .map((market) => market.canonical?.subject ?? "")
        .filter(Boolean),
    [combination, portfolioPlan],
  );
  const playerVisuals = usePlayerVisuals(resultPlayerNames);

  const payout =
    combination && parlayRequest
      ? combination.grossReturn * parlayRequest.stake
      : 0;
  const profit = combination && parlayRequest
    ? payout - parlayRequest.stake
    : 0;
  const evProfit =
    combination && parlayRequest
      ? (combination.expectedProfitOn100 * parlayRequest.stake) / 100
      : 0;

  function buildParlay() {
    if (!canBuildParlay) return;
    setRankingMode(false);
    setActiveParlayIndex(0);
    setParlayRequest({
      markets: currentMarkets,
      minReturn: minReturnNumber,
      maxReturn: maxReturnNumber,
      maxLegs,
      platform,
      live,
      mode,
      objective,
      stake: stakeNumber,
    });
  }

  function showBestParlaysThisWeek() {
    if (currentMarkets.length === 0) return;
    setRankingMode(true);
    setActiveParlayIndex(0);
    setParlayRequest({
      markets: currentMarkets,
      minReturn: 1.3,
      maxReturn: 150,
      maxLegs: 8,
      platform: "either",
      live: "pregame",
      mode: "any",
      objective: "balanced",
      stake:
        Number.isFinite(stakeNumber) && stakeNumber > 0 ? stakeNumber : 100,
    });
  }

  function buildPortfolio() {
    if (!canBuildPortfolio) return;
    setPortfolioRequest({
      markets: currentMarkets,
      amount: planAmountNumber,
      targetPayout: targetPayoutNumber,
      risk: portfolioRisk,
      platform,
      live,
      mode,
      maxLegs,
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-2 rounded-2xl border bg-surface p-2 shadow-[0_8px_30px_rgb(0_0_0/0.025)]">
        <button
          type="button"
          onClick={() => setBuilderView("parlay")}
          className={cn(
            "rounded-xl px-3 py-3 text-left transition-colors",
            builderView === "parlay"
              ? "border border-accent/35 bg-accent-bg text-accent"
              : "border border-transparent hover:bg-surface-raised",
          )}
        >
          <div className="flex items-center gap-2">
            <Layers3 className="size-4" />
            <span className="text-xs font-semibold sm:text-sm">Build one parlay</span>
          </div>
          <p
            className={cn(
              "mt-1 hidden text-[10px] sm:block",
              builderView === "parlay" ? "text-accent/75" : "text-muted",
            )}
          >
            Find the best combination inside a payout range.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setBuilderView("portfolio")}
          className={cn(
            "rounded-xl px-3 py-3 text-left transition-colors",
            builderView === "portfolio"
              ? "border border-accent/35 bg-accent-bg text-accent"
              : "border border-transparent hover:bg-surface-raised",
          )}
        >
          <div className="flex items-center gap-2">
            <WalletCards className="size-4" />
            <span className="text-xs font-semibold sm:text-sm">Plan my money</span>
          </div>
          <p
            className={cn(
              "mt-1 hidden text-[10px] sm:block",
              builderView === "portfolio" ? "text-accent/75" : "text-muted",
            )}
          >
            Split one amount across straights and parlays for a target payout.
          </p>
        </button>
      </section>

      <div className={builderView === "parlay" ? "space-y-5" : "hidden"}>
      <section className="premium-panel overflow-hidden rounded-2xl">
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
            <div className="grid grid-cols-3 gap-2">
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
              <div className="grid grid-cols-3 gap-2">
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
                {minReturnInput || "—"}x to {maxReturnInput || "—"}x
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {RETURN_PRESETS.map((preset) => {
                const active =
                  Number(minReturnInput) === preset.min &&
                  Number(maxReturnInput) === preset.max;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setMinReturnInput(String(preset.min));
                      setMaxReturnInput(String(preset.max));
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
                <div className="control-surface flex h-10 items-center rounded-lg px-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={minReturnInput}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (/^\d*\.?\d*$/.test(next)) setMinReturnInput(next);
                    }}
                    className="w-full bg-transparent text-sm outline-none tabular"
                  />
                  <span className="text-xs text-muted">x</span>
                </div>
              </label>

              <label>
                <FieldLabel>Maximum</FieldLabel>
                <div className="control-surface flex h-10 items-center rounded-lg px-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maxReturnInput}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (/^\d*\.?\d*$/.test(next)) setMaxReturnInput(next);
                    }}
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
              className="control-surface h-10 w-full rounded-lg px-3 text-xs outline-none focus:border-accent"
            >
              <option value="2">2 legs</option>
              <option value="3">3 legs</option>
              <option value="4">4 legs</option>
              <option value="5">5 legs</option>
              <option value="6">6 legs</option>
              <option value="7">7 legs</option>
              <option value="8">8 legs</option>
            </select>
          </label>

          <label>
            <FieldLabel>Platform</FieldLabel>
            <select
              value={platform}
              onChange={(event) =>
                setPlatform(event.target.value as typeof platform)
              }
              className="control-surface h-10 w-full rounded-lg px-3 text-xs outline-none focus:border-accent"
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
              className="control-surface h-10 w-full rounded-lg px-3 text-xs outline-none focus:border-accent"
            >
              <option value="pregame">Pregame only</option>
              <option value="live">Live only</option>
              <option value="all">Pregame + live</option>
            </select>
          </label>

          <label>
            <FieldLabel>Stake</FieldLabel>
            <div className="control-surface flex h-10 items-center rounded-lg px-3">
              <span className="text-xs text-muted">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={stakeInput}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const next = event.target.value;
                  if (/^\d*\.?\d*$/.test(next)) setStakeInput(next);
                }}
                className="w-full bg-transparent pl-1 text-sm outline-none tabular"
              />
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t bg-surface-raised/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-[10px] leading-4 text-muted">
            Adjust anything above first. Lynerva only runs the optimizer when
            you click Build, so changing settings stays instant.
          </p>
          <button
            type="button"
            onClick={buildParlay}
            disabled={!canBuildParlay || currentMarkets.length === 0}
            className="primary-action inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            <Sparkles className="size-3.5" />
            {parlayRequest ? "Update parlay" : "Build parlay"}
          </button>
        </div>
      </section>

      <section className="premium-panel overflow-hidden rounded-2xl">
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
        ) : !parlayRequest ? (
          <div className="px-6 py-16 text-center sm:py-20">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
              <Sparkles className="size-4 text-muted" />
            </div>
            <p className="font-medium">Set your parameters, then build</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">
              Nothing recalculates while you edit. Click Build parlay when the
              settings look right.
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
                      {parlayRequest?.mode === "sgp"
                        ? "Same game parlay"
                        : parlayRequest?.mode === "multi_game"
                          ? "Cross-game build"
                          : "Smart build"}
                    </span>
                    <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-medium text-muted">
                      {parlayRequest?.objective === "balanced"
                        ? "Balanced"
                        : parlayRequest?.objective === "safer"
                          ? "Safer"
                          : "Max EV"}
                    </span>
                  </div>

                  <p className="mt-3 text-2xl font-semibold tracking-[-0.035em] tabular sm:text-3xl">
                    {"$"}{parlayRequest?.stake.toLocaleString()} to about {"$"}{Math.round(payout).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    About {"$"}{Math.round(profit).toLocaleString()} profit at the
                    current market prices.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:min-w-[650px]">
                  <div className={cn(
                    "builder-score-tile rounded-xl border bg-surface p-3",
                    builderScoreTone(combination.lynervaScore),
                  )}>
                    <p className="text-[10px] text-faint">Parlay score</p>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <p className="text-lg font-semibold tabular">
                        {combination.lynervaScore}
                      </p>
                      <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {builderScoreLabel(combination.lynervaScore)}
                      </span>
                    </div>
                  </div>
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

            <ol className="grid items-start gap-3 p-3 sm:p-4 lg:grid-cols-2">
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
                    className={cn(
                      "builder-result-card overflow-hidden rounded-2xl border",
                      builderScoreTone(leg.lynervaScore),
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedMarket(leg)}
                      className="group w-full p-4 text-left sm:p-4.5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative">
                          <SubjectVisual
                            market={leg}
                            visual={playerVisuals[leg.canonical?.subject ?? ""]}
                          />
                          <span className="rank-badge absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full text-[9px] font-bold">
                            {index + 1}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <PlatformMark platform={leg.platform} />
                            <span className="rounded-full border bg-surface/80 px-2 py-0.5 text-[9px] font-semibold">
                              Score {leg.lynervaScore ?? "n/a"}
                            </span>
                            <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[9px] font-semibold text-positive">
                              {formatEdge(
                                (leg.recommendedProbabilityBps ?? 0) -
                                  (leg.executablePriceBps ?? 0),
                              )}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-5">
                            {builderPickLabel(leg)}
                          </p>
                          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                            {matchup}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular">
                            {formatPercent(leg.executablePriceBps)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-positive tabular">
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
                            className="builder-contribution h-full rounded-full transition-[width]"
                            style={{
                              width: `${Math.max(4, contribution * 100)}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] font-medium text-muted transition-colors group-hover:text-foreground">
                        <FlaskConical size={11} />
                        Open Bet Lab
                        <ChevronRight size={11} />
                      </div>
                    </button>
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
                each leg contributes to the final odds. For larger parlays,
                ordinary builds are rejected when one leg carries most of the
                payout. A true longshot only gets through when the reliability-adjusted
                model edge is exceptional.
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

      <div className={builderView === "portfolio" ? "space-y-5" : "hidden"}>
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Bankroll plan</p>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  Tell Lynerva how much you want to put in and the payout you
                  want to aim for. It spreads the money across straight bets and
                  model-backed parlays instead of forcing everything into one ticket.
                </p>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted sm:mt-0">
                <span className="size-1.5 rounded-full bg-positive" />
                {currentMarkets.length.toLocaleString()} eligible markets
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1fr_1.05fr]">
            <div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <FieldLabel>Amount to put in</FieldLabel>
                  <div className="control-surface flex h-11 items-center rounded-xl px-3">
                    <span className="text-xs text-muted">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={planAmountInput}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (/^\d*\.?\d*$/.test(next)) setPlanAmountInput(next);
                      }}
                      className="w-full bg-transparent pl-1 text-sm outline-none tabular"
                    />
                  </div>
                </label>

                <label>
                  <FieldLabel>Wanted payout</FieldLabel>
                  <div className="control-surface flex h-11 items-center rounded-xl px-3">
                    <span className="text-xs text-muted">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={targetPayoutInput}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (/^\d*\.?\d*$/.test(next)) setTargetPayoutInput(next);
                      }}
                      className="w-full bg-transparent pl-1 text-sm outline-none tabular"
                    />
                  </div>
                </label>
              </div>

              <div className="mt-3 rounded-xl border bg-background/55 p-3">
                <div className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-muted">Target return</span>
                  <span className="font-semibold tabular">
                    {draftTargetReturn === null
                      ? "—"
                      : `${draftTargetReturn.toFixed(2)}x`}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-faint">
                  This is an all-win payout target, not a guaranteed return.
                  Lynerva moves more capital toward parlays only when a higher
                  target requires it.
                </p>
              </div>

              <div className="mt-5">
                <FieldLabel>Risk limit</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  <SegmentedButton
                    value="lower"
                    current={portfolioRisk}
                    onClick={setPortfolioRisk}
                    title="Lower"
                    description="More money in straights, smaller position caps."
                    icon={<ShieldCheck className="size-3.5" />}
                  />
                  <SegmentedButton
                    value="balanced"
                    current={portfolioRisk}
                    onClick={setPortfolioRisk}
                    title="Balanced"
                    description="Mix hit rate, diversification, and upside."
                    icon={<BarChart3 className="size-3.5" />}
                  />
                  <SegmentedButton
                    value="higher"
                    current={portfolioRisk}
                    onClick={setPortfolioRisk}
                    title="Higher"
                    description="More parlay exposure when the target needs it."
                    icon={<Zap className="size-3.5" />}
                  />
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>Parlay type</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                <SegmentedButton
                  value="multi_game"
                  current={mode}
                  onClick={setMode}
                  title="Cross-game"
                  description="Use parlays across separate matchups."
                  icon={<Layers3 className="size-3.5" />}
                />
                <SegmentedButton
                  value="sgp"
                  current={mode}
                  onClick={setMode}
                  title="Same game"
                  description="Use same-game parlays from one matchup."
                  icon={<Target className="size-3.5" />}
                />
                <SegmentedButton
                  value="any"
                  current={mode}
                  onClick={setMode}
                  title="Either"
                  description="Let Lynerva compare both parlay structures."
                  icon={<Sparkles className="size-3.5" />}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <label>
                  <FieldLabel>Platform</FieldLabel>
                  <select
                    value={platform}
                    onChange={(event) =>
                      setPlatform(event.target.value as typeof platform)
                    }
                    className="control-surface h-11 w-full rounded-xl px-3 text-xs outline-none focus:border-accent"
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
                    onChange={(event) =>
                      setLive(event.target.value as typeof live)
                    }
                    className="control-surface h-11 w-full rounded-xl px-3 text-xs outline-none focus:border-accent"
                  >
                    <option value="pregame">Pregame only</option>
                    <option value="live">Live only</option>
                    <option value="all">Pregame + live</option>
                  </select>
                </label>

                <label className="col-span-2">
                  <FieldLabel>Maximum parlay legs</FieldLabel>
                  <select
                    value={maxLegs}
                    onChange={(event) => setMaxLegs(Number(event.target.value))}
                    className="control-surface h-11 w-full rounded-xl px-3 text-xs outline-none focus:border-accent"
                  >
                    <option value="3">3 legs</option>
                    <option value="4">4 legs</option>
                    <option value="5">5 legs</option>
                    <option value="6">6 legs</option>
                    <option value="7">7 legs</option>
                    <option value="8">8 legs</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t bg-surface-raised/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-[10px] leading-4 text-muted">
              Set the amount, target, and risk first. The plan is calculated
              only after you click Build.
            </p>
            <button
              type="button"
              onClick={buildPortfolio}
              disabled={!canBuildPortfolio || currentMarkets.length === 0}
              className="primary-action inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              <WalletCards className="size-3.5" />
              {portfolioRequest ? "Update plan" : "Build plan"}
            </button>
          </div>
        </section>

        <section className="premium-panel overflow-hidden rounded-2xl">
          {loading && currentMarkets.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
                <WalletCards className="size-4 text-muted" />
              </div>
              <p className="font-medium">Building your plan...</p>
              <p className="mt-1 text-xs text-muted">
                Lynerva needs the current market snapshot first.
              </p>
            </div>
          ) : !portfolioRequest ? (
            <div className="px-6 py-16 text-center sm:py-20">
              <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
                <WalletCards className="size-4 text-muted" />
              </div>
              <p className="font-medium">Set your target, then build the plan</p>
              <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
                You can change every parameter without rerunning the optimizer.
                Click Build plan when you are ready.
              </p>
            </div>
          ) : !portfolioPlan ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border bg-surface-raised">
                <WalletCards className="size-4 text-muted" />
              </div>
              <p className="font-medium">No diversified plan fits this target</p>
              <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
                Try a lower wanted payout, allow more parlay legs, use either
                parlay type, or raise the risk limit. Lynerva will not fill a
                target with a bad one-leg longshot just to make the math work.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-5 sm:px-6 sm:py-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        BANKROLL PLAN
                      </span>
                      <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-medium capitalize text-muted">
                        {portfolioRequest?.risk} risk
                      </span>
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-[-0.035em] tabular sm:text-3xl">
                      {"$"}{Math.round(portfolioPlan.totalStake).toLocaleString()} spread across {portfolioPlan.positions.length} bets
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Target {"$"}{Math.round(portfolioPlan.targetPayout).toLocaleString()}, all-win payout about {"$"}{Math.round(portfolioPlan.allWinPayout).toLocaleString()}.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:min-w-[680px]">
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Model expected P/L</p>
                      <p
                        className={cn(
                          "mt-1 text-lg font-semibold tabular",
                          portfolioPlan.expectedProfit >= 0
                            ? "text-positive"
                            : "text-negative",
                        )}
                      >
                        {portfolioPlan.expectedProfit >= 0 ? "+" : ""}
                        {"$"}{Math.round(portfolioPlan.expectedProfit)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Straight money</p>
                      <p className="mt-1 text-lg font-semibold tabular">
                        {Math.round(portfolioPlan.straightStakeShare * 100)}%
                      </p>
                    </div>
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Riskier straights</p>
                      <p className="mt-1 text-lg font-semibold tabular">
                        {Math.round(portfolioPlan.riskyStraightStakeShare * 100)}%
                      </p>
                    </div>
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Parlay money</p>
                      <p className="mt-1 text-lg font-semibold tabular">
                        {Math.round(portfolioPlan.parlayStakeShare * 100)}%
                      </p>
                    </div>
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Hail Mary money</p>
                      <p className="mt-1 text-lg font-semibold tabular">
                        {Math.round(portfolioPlan.hailMaryStakeShare * 100)}%
                      </p>
                    </div>
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Largest position</p>
                      <p className="mt-1 text-lg font-semibold tabular">
                        {Math.round(portfolioPlan.maxPositionShare * 100)}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid items-start gap-3 p-3 sm:p-4 lg:grid-cols-2">
                {portfolioPlan.positions.map((position, index) => (
                  <article
                    key={position.id}
                    className={cn(
                      "builder-result-card overflow-hidden rounded-2xl border p-4",
                      builderScoreTone(position.lynervaScore),
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border bg-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
                            {portfolioRoleLabel(
                              position.role,
                              position.parlayMode,
                            )}
                          </span>
                          <span className="text-[9px] text-faint">
                            Bet {index + 1}
                          </span>
                        </div>
                        <p className="mt-2 text-xl font-semibold tabular">
                          {"$"}{position.stake.toFixed(2)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted">
                          Pays about {"$"}{Math.round(position.payoutIfWin).toLocaleString()} if it wins
                        </p>
                      </div>
                      <div className="flex shrink-0 items-start gap-2.5">
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular">
                            {formatPercent(
                              Math.round(position.estimatedProbability * 10_000),
                              1,
                            )}
                          </p>
                          <p className="mt-0.5 text-[9px] text-faint">
                            Model hit chance
                          </p>
                        </div>
                        <div className={cn(
                          "builder-mini-score grid size-11 place-items-center rounded-xl border bg-surface text-center",
                          builderScoreTone(position.lynervaScore),
                        )}>
                          <div>
                            <p className="text-sm font-bold tabular leading-none">
                              {position.lynervaScore}
                            </p>
                            <p className="mt-1 text-[7px] font-semibold uppercase tracking-[0.08em] text-faint">
                              score
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {position.legs.map((leg, legIndex) => (
                        <button
                          key={`${position.id}:${leg.platformMarketId}`}
                          type="button"
                          onClick={() => setSelectedMarket(leg)}
                          className="group flex w-full items-center gap-2.5 rounded-xl border bg-surface/80 px-2.5 py-2.5 text-left transition-all hover:border-strong hover:bg-surface"
                        >
                          <SubjectVisual
                            market={leg}
                            visual={playerVisuals[leg.canonical?.subject ?? ""]}
                            size="sm"
                          />
                          <span className="grid size-5 shrink-0 place-items-center rounded-md border bg-background text-[8px] font-semibold text-muted">
                            {legIndex + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium leading-4">
                              {builderPickLabel(leg)}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-faint">
                              <span>{leg.canonical?.matchup ?? leg.eventTitle}</span>
                              <span>·</span>
                              <span className="capitalize">{leg.platform}</span>
                              <span>·</span>
                              <span>Score {leg.lynervaScore ?? "n/a"}</span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="block text-[10px] font-medium tabular">
                              {formatPercent(leg.executablePriceBps)}
                            </span>
                            <span className="mt-1 inline-flex items-center gap-0.5 text-[8px] text-muted group-hover:text-foreground">
                              <FlaskConical size={9} />
                              Lab
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">Return if win</p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {position.grossReturn.toFixed(2)}x
                        </p>
                      </div>
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">Model expected P/L</p>
                        <p
                          className={cn(
                            "mt-1 text-xs font-semibold tabular",
                            position.expectedProfit >= 0
                              ? "text-positive"
                              : "text-negative",
                          )}
                        >
                          {position.expectedProfit >= 0 ? "+" : ""}
                          {"$"}{position.expectedProfit.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="border-t bg-surface-raised/55 px-4 py-4 text-[11px] leading-5 text-muted sm:px-5">
                <strong className="font-semibold text-foreground">
                  The plan optimizes the mix, not just the biggest payout.
                </strong>{" "}
                It now uses a barbell mix: a safer core, 50% to 70% style
                value straights, a smaller aggressive straight, core and upside
                parlays, and a tiny Hail Mary allocation when your target calls
                for it. Higher payout targets increase upside exposure without
                forcing every dollar of potential return into the same parlay.
              </div>
            </>
          )}
        </section>
      </div>

      {selectedMarket ? (
        <BetLab
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      ) : null}
    </div>
  );
}
