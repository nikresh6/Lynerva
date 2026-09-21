"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  FlaskConical,
  Layers3,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  buildRankedCombinations,
  buildTopScoredCombinations,
  type BuilderMode,
  type BuilderObjective,
  type BuiltCombination,
} from "@/lib/builder";
import {
  findBestMarketReplacement,
  findBestPortfolioBetReplacement,
  rebuildCombinationFromLegs,
  replacePortfolioLeg,
  replacePortfolioPosition,
  type ReplacementDirection,
  type ReplacementOddsPreference,
} from "@/lib/builder/customize";
import {
  buildPortfolioPlan,
  type PortfolioPlan,
  type PortfolioRisk,
} from "@/lib/builder/portfolio";
import { isBuilderSearchableOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatEdge, formatPercent } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";
import { useMarketData } from "./market-data-provider";
import { BetLab } from "./market-table";
import { SubjectVisual } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

type BuilderComboQuote = {
  key: string;
  ticker: string;
  priceBps: number;
  grossReturn: number;
  sourceUrl: string;
};

function comboQuoteKey(legs: MarketOpportunity[]) {
  if (
    legs.length < 2 ||
    legs.some(
      (leg) =>
        leg.platform !== "kalshi" ||
        !leg.platformMarketId ||
        !leg.recommendedSide,
    )
  ) {
    return null;
  }

  return legs
    .map((leg) => `${leg.platformMarketId}:${leg.recommendedSide}`)
    .toSorted()
    .join("|");
}

function comboQuoteRequest(legs: MarketOpportunity[]) {
  const key = comboQuoteKey(legs);
  if (!key) return null;
  return {
    key,
    legs: legs.map((leg) => ({
      marketTicker: leg.platformMarketId,
      side: leg.recommendedSide!,
    })),
  };
}

function builderPickLabel(market: MarketOpportunity) {
  const canonical = market.canonical;
  const threshold = canonical?.threshold;
  const direction = canonical?.direction;

  if (!canonical) return market.marketTitle;
  if (canonical.family === "moneyline") {
    return `${canonical.subject} moneyline`;
  }
  if (threshold === null || threshold === undefined || !direction) {
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
                : canonical.family === "rushing_touchdowns"
                  ? "rushing TDs"
                  : canonical.family === "receiving_touchdowns"
                    ? "receiving TDs"
                    : canonical.family === "touchdowns"
                      ? "anytime TDs"
                      : canonical.family.replaceAll("_", " ");

  if (pickDirection === "yes") {
    return canonical.family === "touchdowns"
      ? `${canonical.subject}: Anytime TD`
      : `${canonical.subject}: Yes ${label}`;
  }
  if (pickDirection === "no") {
    return canonical.family === "touchdowns"
      ? `${canonical.subject}: No touchdown`
      : `${canonical.subject}: No ${label}`;
  }

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
  { label: "20x to 50x", min: 20, max: 50 },
  { label: "50x to 100x", min: 50, max: 100 },
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
    | "hedge_straight"
    | "value_straight"
    | "aggressive_straight"
    | "core_parlay"
    | "upside_parlay"
    | "hail_mary",
  parlayMode: "multi_game" | "sgp" | null,
) {
  if (role === "core_straight") return "Core straight";
  if (role === "hedge_straight") return "Hedge straight";
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

type BuilderSwapTarget =
  | {
      kind: "parlay-leg";
      legIndex: number;
      market: MarketOpportunity;
    }
  | {
      kind: "portfolio-leg";
      positionIndex: number;
      legIndex: number;
      market: MarketOpportunity;
    }
  | {
      kind: "portfolio-bet";
      positionIndex: number;
    };

function replacementDirectionLabel(direction: ReplacementDirection) {
  if (direction === "same") return "Same side";
  if (direction === "over") return "Over";
  if (direction === "under") return "Under";
  if (direction === "moneyline") return "Moneyline";
  return "Any";
}

function replacementOddsLabel(preference: ReplacementOddsPreference) {
  if (preference === "higher") return "Higher payout";
  if (preference === "lower") return "Lower payout";
  return "Similar odds";
}

type BuilderLinePreference = "mixed" | "over" | "under";

function builderLinePreferenceMatches(
  market: MarketOpportunity,
  preference: BuilderLinePreference,
) {
  if (preference === "mixed") return true;

  const direction = builderPickDirectionForUi(market);
  // Over/under preference applies only to true O/U markets. Moneylines,
  // anytime TDs, yes/no interception markets, and other binary props stay in
  // the search universe regardless of this preference.
  if (direction !== "over" && direction !== "under") return true;
  return direction === preference;
}

function builderPickDirectionForUi(
  market: MarketOpportunity,
): ReplacementDirection {
  const canonical = market.canonical;
  if (canonical?.family === "moneyline") return "moneyline";
  const direction =
    market.recommendedSide === "no"
      ? canonical?.direction === "over"
        ? "under"
        : canonical?.direction === "under"
          ? "over"
          : canonical?.direction
      : canonical?.direction;
  return direction === "over" || direction === "under"
    ? direction
    : "any";
}

export function BuilderWorkbench() {
  const { opportunities, loading } = useMarketData();
  const [linePreference, setLinePreference] =
    useState<BuilderLinePreference>("mixed");
  const eligibleMarkets = useMemo(
    () => opportunities.filter(isBuilderSearchableOpportunity),
    [opportunities],
  );
  const currentMarkets = useMemo(
    () =>
      eligibleMarkets.filter((market) =>
        builderLinePreferenceMatches(market, linePreference),
      ),
    [eligibleMarkets, linePreference],
  );
  const optimizerPlayerNames = useMemo(
    () =>
      [...new Set(
        currentMarkets
          .toSorted(
            (first, second) =>
              (second.lynervaScore ?? 0) - (first.lynervaScore ?? 0),
          )
          .map((market) => market.canonical?.subject ?? "")
          .filter(Boolean),
      )].slice(0, 100),
    [currentMarkets],
  );
  const optimizerVisuals = usePlayerVisuals(optimizerPlayerNames);
  const optimizerSubjectTeams = useMemo(
    () =>
      Object.fromEntries(
        optimizerPlayerNames.map((name) => [
          name,
          optimizerVisuals[name]?.team ?? null,
        ]),
      ),
    [optimizerPlayerNames, optimizerVisuals],
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
    linePreference: BuilderLinePreference;
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
    subjectTeams: Record<string, string | null>;
    singleGame: boolean;
    matchup: string | null;
    linePreference: BuilderLinePreference;
  };

  const [minReturnInput, setMinReturnInput] = useState("3");
  const [maxReturnInput, setMaxReturnInput] = useState("6");
  const [maxLegs, setMaxLegs] = useState(6);
  const platform = "kalshi" as const;
  const [live, setLive] = useState<"all" | "pregame" | "live">("pregame");
  const [mode, setMode] = useState<BuilderMode>("multi_game");
  const [objective, setObjective] = useState<BuilderObjective>("balanced");
  const [stakeInput, setStakeInput] = useState("100");
  const [builderView, setBuilderView] = useState<"parlay" | "portfolio">("parlay");
  const [planAmountInput, setPlanAmountInput] = useState("100");
  const [targetPayoutInput, setTargetPayoutInput] = useState("250");
  const [portfolioRisk, setPortfolioRisk] =
    useState<PortfolioRisk>("balanced");
  const [portfolioScope, setPortfolioScope] =
    useState<"all" | "single">("all");
  const [portfolioMatchup, setPortfolioMatchup] = useState("");
  const [parlayRequest, setParlayRequest] =
    useState<ParlayRequest | null>(null);
  const [portfolioRequest, setPortfolioRequest] =
    useState<PortfolioRequest | null>(null);
  const [selectedMarket, setSelectedMarket] =
    useState<MarketOpportunity | null>(null);
  const [customCombination, setCustomCombination] =
    useState<BuiltCombination | null>(null);
  const [customPortfolioPlan, setCustomPortfolioPlan] =
    useState<PortfolioPlan | null>(null);
  const [swapTarget, setSwapTarget] = useState<BuilderSwapTarget | null>(null);
  const [swapDirection, setSwapDirection] =
    useState<ReplacementDirection>("any");
  const [swapOddsPreference, setSwapOddsPreference] =
    useState<ReplacementOddsPreference>("similar");
  const [comboQuotes, setComboQuotes] = useState<Record<string, BuilderComboQuote>>({});
  const [rankingMode, setRankingMode] = useState(false);
  const [activeParlayIndex, setActiveParlayIndex] = useState(0);
  const [processing, setProcessing] = useState<
    "parlay" | "portfolio" | "weekly" | null
  >(null);

  const minReturnNumber = Number(minReturnInput);
  const maxReturnNumber = Number(maxReturnInput);
  const stakeNumber = Number(stakeInput);
  const planAmountNumber = Number(planAmountInput);
  const targetPayoutNumber = Number(targetPayoutInput);
  const availablePortfolioMatchups = useMemo(
    () =>
      [...new Set(
        currentMarkets
          .map((market) => market.canonical?.matchup ?? "")
          .filter(Boolean),
      )].toSorted(),
    [currentMarkets],
  );
  const effectivePortfolioMatchup =
    portfolioMatchup || availablePortfolioMatchups[0] || "";

  const canBuildParlay =
    Number.isFinite(minReturnNumber) &&
    Number.isFinite(maxReturnNumber) &&
    Number.isFinite(stakeNumber) &&
    minReturnNumber > 1 &&
    maxReturnNumber >= minReturnNumber &&
    maxReturnNumber <= 500 &&
    stakeNumber > 0;

  const canBuildPortfolio =
    Number.isFinite(planAmountNumber) &&
    Number.isFinite(targetPayoutNumber) &&
    planAmountNumber > 0 &&
    targetPayoutNumber > planAmountNumber &&
    (portfolioScope === "all" || Boolean(effectivePortfolioMatchup));

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

  const baseCombination =
    combinations[activeParlayIndex] ?? combinations[0] ?? null;
  const combination = customCombination ?? baseCombination;

  const generatedPortfolioPlan = useMemo(() => {
    if (!portfolioRequest) return null;
    return buildPortfolioPlan(portfolioRequest.markets, {
      amount: portfolioRequest.amount,
      targetPayout: portfolioRequest.targetPayout,
      risk: portfolioRequest.risk,
      platform: portfolioRequest.platform,
      live: portfolioRequest.live,
      mode: portfolioRequest.mode,
      maxLegs: portfolioRequest.maxLegs,
      subjectTeams: portfolioRequest.subjectTeams,
      singleGame: portfolioRequest.singleGame,
      maxPositions: portfolioRequest.singleGame ? 4 : undefined,
    });
  }, [portfolioRequest]);
  const portfolioPlan = customPortfolioPlan ?? generatedPortfolioPlan;

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

  const comboQuoteRequests = useMemo(() => {
    const requests = new Map<
      string,
      NonNullable<ReturnType<typeof comboQuoteRequest>>
    >();

    const add = (legs: MarketOpportunity[]) => {
      const request = comboQuoteRequest(legs);
      if (request && !requests.has(request.key)) {
        requests.set(request.key, request);
      }
    };

    for (const row of combinations) add(row.legs);
    if (combination) add(combination.legs);
    for (const position of portfolioPlan?.positions ?? []) {
      if (position.kind === "parlay") add(position.legs);
    }

    return [...requests.values()].slice(0, 24);
  }, [combinations, combination, portfolioPlan]);

  useEffect(() => {
    if (!comboQuoteRequests.length) {
      setComboQuotes({});
      return;
    }

    const controller = new AbortController();
    void fetch("/api/builder/combo-quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ combinations: comboQuoteRequests }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { quotes: [] as BuilderComboQuote[] };
        return (await response.json()) as { quotes?: BuilderComboQuote[] };
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const next: Record<string, BuilderComboQuote> = {};
        for (const quote of payload.quotes ?? []) next[quote.key] = quote;
        setComboQuotes(next);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Kalshi combo quote lookup failed", error);
        setComboQuotes({});
      });

    return () => controller.abort();
  }, [comboQuoteRequests]);

  const currentComboQuote =
    combination && comboQuoteKey(combination.legs)
      ? comboQuotes[comboQuoteKey(combination.legs)!] ?? null
      : null;
  const displayGrossReturn =
    currentComboQuote?.grossReturn ?? combination?.grossReturn ?? 0;
  const displayImpliedProbability =
    currentComboQuote?.priceBps !== undefined
      ? currentComboQuote.priceBps / 10_000
      : combination?.impliedProbability ?? 0;

  const portfolioDisplay = useMemo(() => {
    if (!portfolioPlan) return null;
    const positions = portfolioPlan.positions.map((position) => {
      const key = position.kind === "parlay" ? comboQuoteKey(position.legs) : null;
      const quote = key ? comboQuotes[key] ?? null : null;
      const grossReturn = quote?.grossReturn ?? position.grossReturn;
      const expectedValueMultiplier =
        position.estimatedProbability * grossReturn;
      return {
        id: position.id,
        stake: position.stake,
        grossReturn,
        expectedProfit: position.stake * (expectedValueMultiplier - 1),
        payoutIfWin: position.stake * grossReturn,
        exactQuote: Boolean(quote),
      };
    });
    const allWinPayout = positions.reduce(
      (sum, position) => sum + position.payoutIfWin,
      0,
    );
    const expectedPayout = positions.reduce(
      (sum, position) =>
        sum + position.stake + position.expectedProfit,
      0,
    );
    return {
      byId: Object.fromEntries(positions.map((position) => [position.id, position])),
      allWinPayout,
      expectedProfit: expectedPayout - portfolioPlan.totalStake,
      exactQuoteCount: positions.filter((position) => position.exactQuote).length,
    };
  }, [portfolioPlan, comboQuotes]);

  const swapMarketOption = useMemo(() => {
    if (!swapTarget || swapTarget.kind === "portfolio-bet") return null;

    const target = swapTarget.market;
    const existingLegs =
      swapTarget.kind === "parlay-leg"
        ? (combination?.legs ?? []).filter(
            (_, index) => index !== swapTarget.legIndex,
          )
        : (portfolioPlan?.positions ?? []).flatMap((position, positionIndex) =>
            position.legs.filter(
              (_, legIndex) =>
                positionIndex !== swapTarget.positionIndex ||
                legIndex !== swapTarget.legIndex,
            ),
          );

    const swapMode =
      swapTarget.kind === "parlay-leg"
        ? parlayRequest?.mode ?? "any"
        : portfolioPlan?.positions[swapTarget.positionIndex]?.parlayMode ??
          "any";

    const replacementUniverse =
      swapTarget.kind === "portfolio-leg" &&
      portfolioRequest?.singleGame &&
      portfolioRequest.matchup
        ? eligibleMarkets.filter(
            (market) =>
              market.canonical?.matchup === portfolioRequest.matchup,
          )
        : eligibleMarkets;

    return findBestMarketReplacement(replacementUniverse, target, {
      direction: swapDirection,
      oddsPreference: swapOddsPreference,
      existingLegs,
      mode: swapMode,
      singleGame:
        swapTarget.kind === "portfolio-leg"
          ? portfolioRequest?.singleGame
          : false,
    });
  }, [
    swapTarget,
    swapDirection,
    swapOddsPreference,
    eligibleMarkets,
    combination,
    portfolioPlan,
    parlayRequest,
    portfolioRequest,
  ]);

  const swapBetOption = useMemo(() => {
    if (
      !swapTarget ||
      swapTarget.kind !== "portfolio-bet" ||
      !portfolioPlan ||
      !portfolioRequest
    ) {
      return null;
    }

    const position = portfolioPlan.positions[swapTarget.positionIndex];
    if (!position) return null;
    const replacementUniverse =
      portfolioRequest.singleGame && portfolioRequest.matchup
        ? eligibleMarkets.filter(
            (market) =>
              market.canonical?.matchup === portfolioRequest.matchup,
          )
        : eligibleMarkets;

    return findBestPortfolioBetReplacement(replacementUniverse, position, {
      direction: swapDirection,
      oddsPreference: swapOddsPreference,
      mode: portfolioRequest.mode,
      live: portfolioRequest.live,
      existingPositions: portfolioPlan.positions.filter(
        (_, index) => index !== swapTarget.positionIndex,
      ),
      singleGame: portfolioRequest.singleGame,
    });
  }, [
    swapTarget,
    swapDirection,
    swapOddsPreference,
    eligibleMarkets,
    portfolioPlan,
    portfolioRequest,
  ]);

  const payout =
    combination && parlayRequest
      ? displayGrossReturn * parlayRequest.stake
      : 0;
  const profit = combination && parlayRequest
    ? payout - parlayRequest.stake
    : 0;
  const evProfit =
    combination && parlayRequest
      ? (combination.estimatedProbability * displayGrossReturn - 1) *
        parlayRequest.stake
      : 0;

  function runWithProgress(
    kind: "parlay" | "portfolio" | "weekly",
    work: () => void,
  ) {
    setProcessing(kind);
    window.setTimeout(() => {
      work();
      setProcessing(null);
    }, 90);
  }

  function buildParlay() {
    if (!canBuildParlay || processing) return;
    runWithProgress("parlay", () => {
      setRankingMode(false);
      setActiveParlayIndex(0);
      setCustomCombination(null);
      setSwapTarget(null);
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
        linePreference,
      });
    });
  }

  function showBestParlaysThisWeek() {
    if (currentMarkets.length === 0 || processing) return;
    runWithProgress("weekly", () => {
      setRankingMode(true);
      setActiveParlayIndex(0);
      setCustomCombination(null);
      setSwapTarget(null);
      setParlayRequest({
        markets: currentMarkets,
        minReturn: 1.3,
        maxReturn: 500,
        maxLegs: 10,
        platform: "kalshi",
        live: "pregame",
        mode: "any",
        objective: "balanced",
        stake:
          Number.isFinite(stakeNumber) && stakeNumber > 0 ? stakeNumber : 100,
        linePreference,
      });
    });
  }

  function buildPortfolio() {
    if (!canBuildPortfolio || processing) return;
    runWithProgress("portfolio", () => {
      setCustomPortfolioPlan(null);
      setSwapTarget(null);
      const singleGame = portfolioScope === "single";
      const scopedMarkets = singleGame
        ? currentMarkets.filter(
            (market) => market.canonical?.matchup === effectivePortfolioMatchup,
          )
        : currentMarkets;
      setPortfolioRequest({
        markets: scopedMarkets,
        amount: planAmountNumber,
        targetPayout: targetPayoutNumber,
        risk: portfolioRisk,
        platform,
        live,
        mode: singleGame ? "sgp" : mode,
        maxLegs,
        subjectTeams: optimizerSubjectTeams,
        singleGame,
        matchup: singleGame ? effectivePortfolioMatchup : null,
        linePreference,
      });
    });
  }

  function openParlayLegSwap(index: number, market: MarketOpportunity) {
    setSwapDirection("any");
    setSwapOddsPreference("similar");
    setSwapTarget({ kind: "parlay-leg", legIndex: index, market });
  }

  function openPortfolioLegSwap(
    positionIndex: number,
    legIndex: number,
    market: MarketOpportunity,
  ) {
    setSwapDirection("any");
    setSwapOddsPreference("similar");
    setSwapTarget({
      kind: "portfolio-leg",
      positionIndex,
      legIndex,
      market,
    });
  }

  function openPortfolioBetSwap(positionIndex: number) {
    setSwapDirection("any");
    setSwapOddsPreference("similar");
    setSwapTarget({ kind: "portfolio-bet", positionIndex });
  }

  function applyMarketSwap(replacement: MarketOpportunity) {
    if (!swapTarget || swapTarget.kind === "portfolio-bet") return;

    if (swapTarget.kind === "parlay-leg") {
      if (!combination) return;
      const legs = [...combination.legs];
      legs[swapTarget.legIndex] = replacement;
      const rebuilt = rebuildCombinationFromLegs(legs);
      if (rebuilt) setCustomCombination(rebuilt);
    } else if (portfolioPlan) {
      setCustomPortfolioPlan(
        replacePortfolioLeg(
          portfolioPlan,
          swapTarget.positionIndex,
          swapTarget.legIndex,
          replacement,
        ),
      );
    }

    setSwapTarget(null);
  }

  function applyPortfolioBetSwap(
    replacement:
      | { kind: "straight"; market: MarketOpportunity }
      | { kind: "parlay"; combination: BuiltCombination },
  ) {
    if (
      !swapTarget ||
      swapTarget.kind !== "portfolio-bet" ||
      !portfolioPlan
    ) {
      return;
    }
    setCustomPortfolioPlan(
      replacePortfolioPosition(
        portfolioPlan,
        swapTarget.positionIndex,
        replacement,
      ),
    );
    setSwapTarget(null);
  }

  return (
    <div className="relative space-y-5">
      {processing ? (
        <div className="builder-processing pointer-events-none sticky top-[58px] z-40 -mb-2 overflow-hidden rounded-xl border border-accent/25 bg-accent-bg/95 px-4 py-2.5 shadow-[0_10px_30px_var(--accent-glow)] backdrop-blur-xl sm:top-14">
          <div className="flex items-center justify-between gap-3 text-[10px] font-semibold text-accent">
            <span>
              {processing === "portfolio"
                ? "Optimizing bankroll plan"
                : processing === "weekly"
                  ? "Scanning the full Kalshi board"
                  : "Building ranked parlays"}
            </span>
            <span className="tabular">HUDDLEMARK</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface">
            <div className="builder-progress h-full rounded-full bg-accent" />
          </div>
        </div>
      ) : null}
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
            Get several ranked combinations inside a payout range.
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

      {builderView === "parlay" ? (
      <div className="space-y-5">
      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Build setup</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Pick the structure first, then tell Huddlemark what kind of build
                you want.
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted sm:mt-0">
              <span className="size-1.5 rounded-full bg-positive" />
              {currentMarkets.length.toLocaleString()} eligible live markets
            </div>
          </div>
        </div>

        <div className="border-b bg-accent-bg/35 p-3 sm:p-4">
          <button
            type="button"
            onClick={showBestParlaysThisWeek}
            disabled={currentMarkets.length === 0 || Boolean(processing)}
            className="group flex w-full items-center gap-3 rounded-2xl border border-accent/30 bg-surface px-4 py-3.5 text-left transition-all hover:border-accent/50 hover:shadow-[0_12px_32px_var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-bg text-accent">
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {processing === "weekly"
                  ? "Searching the full board..."
                  : "Show me the best parlays of the week"}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                Huddlemark searches every eligible pregame market that matches
                your line preference and ranks the strongest combinations by parlay score.
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
          </button>
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

            <div className="mt-5">
              <FieldLabel>Line preference</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                <SegmentedButton
                  value="mixed"
                  current={linePreference}
                  onClick={setLinePreference}
                  title="Mixed"
                  description="Allow overs, unders, and other eligible markets."
                  icon={<Sparkles className="size-3.5" />}
                />
                <SegmentedButton
                  value="over"
                  current={linePreference}
                  onClick={setLinePreference}
                  title="Overs only"
                  description="Use overs for O/U props. Moneylines and binary props stay available."
                  icon={<ArrowRight className="-rotate-45 size-3.5" />}
                />
                <SegmentedButton
                  value="under"
                  current={linePreference}
                  onClick={setLinePreference}
                  title="Unders only"
                  description="Use unders for O/U props. Moneylines and binary props stay available."
                  icon={<ArrowRight className="rotate-45 size-3.5" />}
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

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              <option value="9">9 legs</option>
              <option value="10">10 legs</option>
            </select>
          </label>

          <div>
            <FieldLabel>Market</FieldLabel>
            <div className="control-surface flex h-10 items-center justify-between rounded-lg px-3 text-xs">
              <span className="font-medium">Kalshi</span>
              <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[9px] font-semibold text-positive">
                Live feed
              </span>
            </div>
          </div>

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
            Adjust anything above first. Huddlemark only runs the optimizer when
            you click Build, so changing settings stays instant.
          </p>
          <button
            type="button"
            onClick={buildParlay}
            disabled={!canBuildParlay || currentMarkets.length === 0 || Boolean(processing)}
            className="primary-action inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            <Sparkles className="size-3.5" />
            {processing === "parlay"
              ? "Building..."
              : parlayRequest && !rankingMode
                ? "Update parlays"
                : "Build parlays"}
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
            {combinations.length > 1 ? (
              <div className="border-b bg-background/35 px-3 py-3 sm:px-4 sm:py-4">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold">
                      {rankingMode ? "Best parlays this week" : "Top matching parlays"}
                    </p>
                    <p className="mt-0.5 text-[9px] text-muted">
                      Ranked by combination quality. Tap one to inspect every leg.
                    </p>
                  </div>
                  <span className="rounded-full border bg-surface px-2.5 py-1 text-[9px] font-semibold text-muted">
                    {combinations.length} ranked
                  </span>
                </div>
                <div className="scrollbar-subtle flex snap-x gap-2 overflow-x-auto pb-1">
                  {combinations.map((row, index) => {
                    const active = combination === row;
                    return (
                      <button
                        key={row.legs
                          .map((leg) => `${leg.platform}:${leg.platformMarketId}`)
                          .join("|")}
                        type="button"
                        onClick={() => {
                          setActiveParlayIndex(index);
                          setCustomCombination(null);
                          setSwapTarget(null);
                        }}
                        className={cn(
                          "min-w-[164px] snap-start rounded-xl border px-3 py-2.5 text-left transition-all sm:min-w-[180px]",
                          active
                            ? "border-accent/45 bg-accent-bg shadow-[0_8px_24px_var(--accent-glow)]"
                            : "bg-surface hover:border-strong hover:bg-surface-raised",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
                            #{index + 1}
                          </span>
                          <span className={cn(
                            "rounded-full border px-2 py-0.5 text-[9px] font-bold tabular",
                            builderScoreTone(row.lynervaScore),
                          )}>
                            {row.lynervaScore}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold tabular">
                          {(comboQuotes[comboQuoteKey(row.legs) ?? ""]?.grossReturn ?? row.grossReturn).toFixed(2)}x{" "}
                          {comboQuotes[comboQuoteKey(row.legs) ?? ""] ? "live" : "est."}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-[9px] text-muted">
                          <span>{row.legs.length} legs</span>
                          <span>
                            {formatPercent(
                              Math.round(row.estimatedProbability * 10_000),
                              1,
                            )} hit
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {rankingMode
                        ? "Best of week"
                        : parlayRequest?.mode === "sgp"
                          ? "Same game parlay"
                          : parlayRequest?.mode === "multi_game"
                            ? "Cross-game build"
                            : "Smart build"}
                    </span>
                    <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-medium text-muted">
                      {rankingMode
                        ? "Score ranked"
                        : parlayRequest?.objective === "balanced"
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
                    {currentComboQuote
                      ? <>Live Kalshi combo quote, about {"$"}{Math.round(profit).toLocaleString()} profit at the current combo ask.</>
                      : <>Independent-leg estimate, about {"$"}{Math.round(profit).toLocaleString()} profit. Kalshi can price the final combo differently from the product of the single-leg asks.</>}
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
                        Math.round(displayImpliedProbability * 10_000),
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
                      onClick={() => openParlayLegSwap(index, leg)}
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

                      <div className="mt-3 flex items-center justify-end gap-1 text-[10px] font-medium text-accent">
                        <RefreshCw size={11} />
                        Click to replace this leg
                        <ChevronRight size={11} />
                      </div>
                    </button>
                    <div className="flex items-center justify-between border-t bg-background/45 px-4 py-2">
                      <span className="text-[9px] text-faint">
                        Swap keeps the odds close by default.
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedMarket(leg)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground"
                      >
                        <FlaskConical size={10} />
                        Bet Lab
                      </button>
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
                Tap any leg, choose I don't care, Over, or Under, then choose similar, higher, or lower payout. Huddlemark picks the replacement for you from the full modeled board. The builder penalizes repeated players and rejects normal tickets where one longshot carries most of the payout, but it does not force artificial stat-category diversity.
                {" "}When Kalshi already exposes this exact combo market, Huddlemark uses its live combo ask. Otherwise the displayed return is an independent-leg estimate from the executable single-leg prices, and the eventual checkout quote can differ.
                {combination.correlationWarning
                  ? " Same-game hit probability is also approximate because the legs can be correlated."
                  : ""}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted">
                <span className="rounded-full border bg-surface px-2.5 py-1 tabular">
                  {combination.legs.length} legs
                </span>
                <ArrowRight className="size-3.5" />
                <span className="rounded-full border bg-surface px-2.5 py-1 tabular">
                  {displayGrossReturn.toFixed(2)}x {currentComboQuote ? "live" : "est."}
                </span>
              </div>
            </div>
          </>
        )}
      </section>
      </div>
      ) : null}

      {builderView === "portfolio" ? (
      <div className="space-y-5">
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Bankroll plan</p>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  Tell Huddlemark how much you want to put in and the payout you
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
                  Huddlemark moves more capital toward parlays only when a higher
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

              <div className="mt-5">
                <FieldLabel>Line preference</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  <SegmentedButton
                    value="mixed"
                    current={linePreference}
                    onClick={setLinePreference}
                    title="Mixed"
                    description="Use the strongest eligible lines."
                    icon={<Sparkles className="size-3.5" />}
                  />
                  <SegmentedButton
                    value="over"
                    current={linePreference}
                    onClick={setLinePreference}
                    title="Overs only"
                    description="Use overs for O/U props. Moneylines and binary props remain eligible."
                    icon={<ArrowRight className="-rotate-45 size-3.5" />}
                  />
                  <SegmentedButton
                    value="under"
                    current={linePreference}
                    onClick={setLinePreference}
                    title="Unders only"
                    description="Use unders for O/U props. Moneylines and binary props remain eligible."
                    icon={<ArrowRight className="rotate-45 size-3.5" />}
                  />
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>Portfolio scope</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <SegmentedButton
                  value="all"
                  current={portfolioScope}
                  onClick={setPortfolioScope}
                  title="All games"
                  description="Diversify across the full slate."
                  icon={<Layers3 className="size-3.5" />}
                />
                <SegmentedButton
                  value="single"
                  current={portfolioScope}
                  onClick={setPortfolioScope}
                  title="One game"
                  description="Up to four focused bets from one matchup."
                  icon={<Target className="size-3.5" />}
                />
              </div>

              {portfolioScope === "single" ? (
                <label className="mt-3 block">
                  <FieldLabel>Game</FieldLabel>
                  <select
                    value={effectivePortfolioMatchup}
                    onChange={(event) => setPortfolioMatchup(event.target.value)}
                    className="control-surface h-11 w-full rounded-xl px-3 text-xs outline-none focus:border-accent"
                  >
                    {availablePortfolioMatchups.map((matchup) => (
                      <option key={matchup} value={matchup}>
                        {matchup.replace("-", " vs ")}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[9px] leading-4 text-faint">
                    One-game plans use at most four bets. The same player cannot
                    appear twice unless the overlap is a yardage bet paired with
                    a touchdown bet.
                  </p>
                </label>
              ) : (
                <div className="mt-5">
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
                      description="Let Huddlemark compare both parlay structures."
                      icon={<Sparkles className="size-3.5" />}
                    />
                  </div>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Market</FieldLabel>
                  <div className="control-surface flex h-11 items-center justify-between rounded-xl px-3 text-xs">
                    <span className="font-medium">Kalshi</span>
                    <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[9px] font-semibold text-positive">
                      Live feed
                    </span>
                  </div>
                </div>

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
                    <option value="9">9 legs</option>
                    <option value="10">10 legs</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t bg-surface-raised/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-[10px] leading-4 text-muted">
              {portfolioScope === "single"
                ? "One-game mode caps the plan at four bets and avoids repeated players, except yardage plus touchdown."
                : "Set the amount, target, and risk first. The plan is calculated only after you click Build."}
            </p>
            <button
              type="button"
              onClick={buildPortfolio}
              disabled={!canBuildPortfolio || currentMarkets.length === 0 || Boolean(processing)}
              className="primary-action inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              <WalletCards className="size-3.5" />
              {processing === "portfolio"
                ? "Building..."
                : portfolioRequest
                  ? "Update plan"
                  : "Build plan"}
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
                Huddlemark needs the current market snapshot first.
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
              <p className="font-medium">Not enough compatible markets yet</p>
              <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
                The optimizer now relaxes payout and edge preferences before giving up. If this still appears, the current board does not contain enough compatible priced markets for the requested structure.
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
                      {portfolioRequest?.singleGame ? (
                        <span className="rounded-full border border-accent/30 bg-accent-bg px-2.5 py-1 text-[10px] font-medium text-accent">
                          {portfolioRequest.matchup?.replace("-", " vs ")} · 4-bet max
                        </span>
                      ) : null}
                      {portfolioRequest?.linePreference !== "mixed" ? (
                        <span className="rounded-full border border-accent/30 bg-accent-bg px-2.5 py-1 text-[10px] font-medium text-accent">
                          {portfolioRequest?.linePreference === "over"
                            ? "Overs only"
                            : "Unders only"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-[-0.035em] tabular sm:text-3xl">
                      {"$"}{Math.round(portfolioPlan.totalStake).toLocaleString()} spread across {portfolioPlan.positions.length} bets
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Target {"$"}{Math.round(portfolioPlan.targetPayout).toLocaleString()}, current all-win payout about {"$"}{Math.round(portfolioDisplay?.allWinPayout ?? portfolioPlan.allWinPayout).toLocaleString()}.
                      {portfolioDisplay?.exactQuoteCount ? ` ${portfolioDisplay.exactQuoteCount} parlay quote${portfolioDisplay.exactQuoteCount === 1 ? "" : "s"} matched live on Kalshi.` : ""}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:min-w-[680px]">
                    <div className="rounded-xl border bg-surface p-3">
                      <p className="text-[10px] text-faint">Model expected P/L</p>
                      <p
                        className={cn(
                          "mt-1 text-lg font-semibold tabular",
                          (portfolioDisplay?.expectedProfit ?? portfolioPlan.expectedProfit) >= 0
                            ? "text-positive"
                            : "text-negative",
                        )}
                      >
                        {(portfolioDisplay?.expectedProfit ?? portfolioPlan.expectedProfit) >= 0 ? "+" : ""}
                        {"$"}{Math.round(portfolioDisplay?.expectedProfit ?? portfolioPlan.expectedProfit)}
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
                {portfolioPlan.positions.map((position, index) => {
                  const display =
                    portfolioDisplay?.byId[position.id] ?? {
                      grossReturn: position.grossReturn,
                      expectedProfit: position.expectedProfit,
                      payoutIfWin: position.payoutIfWin,
                      exactQuote: false,
                    };
                  return (
                  <article
                    key={position.id}
                    className={cn(
                      "builder-result-card overflow-hidden rounded-2xl border p-4",
                      builderScoreTone(position.lynervaScore),
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openPortfolioBetSwap(index)}
                      className="group flex w-full items-start justify-between gap-3 rounded-xl text-left"
                    >
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
                          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[9px] font-semibold text-accent transition-colors group-hover:bg-accent-bg">
                            <RefreshCw size={9} />
                            Click to replace bet
                          </span>
                        </div>
                        <p className="mt-2 text-xl font-semibold tabular">
                          {"$"}{position.stake.toFixed(2)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted">
                          Pays about {"$"}{Math.round(display.payoutIfWin).toLocaleString()} if it wins
                          {position.kind === "parlay" ? (display.exactQuote ? " · live Kalshi combo quote" : " · estimated from leg prices") : ""}
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
                    </button>

                    <div className="mt-4 space-y-2">
                      {position.legs.map((leg, legIndex) => (
                        <div
                          key={`${position.id}:${leg.platformMarketId}`}
                          className="group flex w-full items-center gap-2 rounded-xl border bg-surface/80 p-1.5 transition-all hover:border-strong hover:bg-surface"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              openPortfolioLegSwap(index, legIndex, leg)
                            }
                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left"
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
                            <span className="mt-1 inline-flex items-center gap-0.5 text-[8px] text-accent">
                              <RefreshCw size={9} />
                              Replace
                            </span>
                          </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedMarket(leg)}
                            className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-muted transition-colors hover:text-foreground"
                            aria-label="Open Bet Lab"
                            title="Open Bet Lab"
                          >
                            <FlaskConical size={11} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">{position.kind === "parlay" ? (display.exactQuote ? "Live combo return" : "Est. return if win") : "Return if win"}</p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {display.grossReturn.toFixed(2)}x
                        </p>
                      </div>
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">Model expected P/L</p>
                        <p
                          className={cn(
                            "mt-1 text-xs font-semibold tabular",
                            display.expectedProfit >= 0
                              ? "text-positive"
                              : "text-negative",
                          )}
                        >
                          {display.expectedProfit >= 0 ? "+" : ""}
                          {"$"}{display.expectedProfit.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>

              <div className="border-t bg-surface-raised/55 px-4 py-4 text-[11px] leading-5 text-muted sm:px-5">
                <strong className="font-semibold text-foreground">
                  The plan optimizes the mix, not just the biggest payout.
                </strong>{" "}
                {portfolioRequest?.singleGame
                  ? "One-game mode keeps the plan to at most four bets and avoids repeating the same player across positions, except when the overlap is specifically yardage plus touchdown."
                  : "It now spreads capital across core straights, a hedge when the board offers a real offset, value straights, balanced core parlays, longer value parlays, and a small Hail Mary sleeve when the target calls for it. The payout target changes the mix, but no ordinary parlay is allowed to swallow most of the bankroll."}
              </div>
            </>
          )}
        </section>
      </div>
      ) : null}

      {swapTarget ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Replace builder selection"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSwapTarget(null);
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border bg-surface shadow-2xl">
            <div className="border-b bg-surface/95 px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
                    <SlidersHorizontal className="size-3.5" />
                    Smart replacement
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">
                    {swapTarget.kind === "portfolio-bet"
                      ? "Replace this bet"
                      : "Replace this leg"}
                  </h3>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Pick the direction and payout shape. Huddlemark chooses one
                    replacement using the full market board, prioritizing model
                    value, reliability, fit, and a different player thesis.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSwapTarget(null)}
                  className="grid size-9 shrink-0 place-items-center rounded-xl border bg-background text-muted hover:text-foreground"
                  aria-label="Close replacement picker"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                <div>
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Direction
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["any", "I don't care"],
                      ["over", "Over"],
                      ["under", "Under"],
                    ] as const).map(([direction, label]) => (
                      <button
                        key={direction}
                        type="button"
                        onClick={() => setSwapDirection(direction)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-[10px] font-semibold transition-colors",
                          swapDirection === direction
                            ? "border-accent/40 bg-accent-bg text-accent"
                            : "bg-background text-muted hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Odds
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["similar", "Similar"],
                      ["higher", "Higher payout"],
                      ["lower", "Lower payout"],
                    ] as const).map(([preference, label]) => (
                      <button
                        key={preference}
                        type="button"
                        onClick={() => setSwapOddsPreference(preference)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-[10px] font-semibold transition-colors",
                          swapOddsPreference === preference
                            ? "border-accent/40 bg-accent-bg text-accent"
                            : "bg-background text-muted hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold text-foreground">
                  Huddlemark's replacement
                </p>
                <span className="text-[9px] text-faint">
                  {swapDirection === "any"
                    ? "Any direction"
                    : replacementDirectionLabel(swapDirection)}{" "}
                  · {replacementOddsLabel(swapOddsPreference)}
                </span>
              </div>

              {swapTarget.kind === "portfolio-bet" ? (
                swapBetOption ? (
                  (() => {
                    const legs =
                      swapBetOption.kind === "straight"
                        ? [swapBetOption.market]
                        : swapBetOption.combination.legs;
                    const grossReturn =
                      swapBetOption.kind === "straight"
                        ? 10_000 /
                          Math.max(
                            swapBetOption.market.executablePriceBps ?? 1,
                            1,
                          )
                        : swapBetOption.combination.grossReturn;
                    const score =
                      swapBetOption.kind === "straight"
                        ? swapBetOption.market.lynervaScore
                        : swapBetOption.combination.lynervaScore;
                    return (
                      <button
                        type="button"
                        onClick={() => applyPortfolioBetSwap(swapBetOption)}
                        className="w-full rounded-2xl border border-accent/25 bg-accent-bg/15 p-4 text-left transition-all hover:bg-accent-bg/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              {swapBetOption.kind === "straight"
                                ? builderPickLabel(swapBetOption.market)
                                : `${legs.length}-leg parlay`}
                            </p>
                            <p className="mt-1 text-[9px] leading-4 text-muted">
                              {swapBetOption.kind === "straight"
                                ? swapBetOption.market.canonical?.matchup ??
                                  swapBetOption.market.eventTitle
                                : legs
                                    .map((leg) => builderPickLabel(leg))
                                    .join(" · ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular">
                              {grossReturn.toFixed(2)}x est.
                            </p>
                            <p className="mt-0.5 text-[9px] text-muted">
                              Score {score ?? "n/a"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-1 text-[10px] font-semibold text-accent">
                          Use this replacement
                          <ChevronRight size={11} />
                        </div>
                      </button>
                    );
                  })()
                ) : (
                  <div className="rounded-2xl border bg-background p-7 text-center">
                    <p className="text-sm font-semibold">No exact fit found</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted">
                      Try I don't care for direction. The engine already relaxes
                      edge and payout distance before giving up.
                    </p>
                  </div>
                )
              ) : swapMarketOption ? (
                <button
                  type="button"
                  onClick={() => applyMarketSwap(swapMarketOption)}
                  className="w-full rounded-2xl border border-accent/25 bg-accent-bg/15 p-4 text-left transition-all hover:bg-accent-bg/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PlatformMark platform={swapMarketOption.platform} />
                        <span className="rounded-full border bg-surface px-2 py-0.5 text-[8px] font-semibold">
                          {replacementDirectionLabel(
                            builderPickDirectionForUi(swapMarketOption),
                          )}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-5">
                        {builderPickLabel(swapMarketOption)}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-faint">
                        {swapMarketOption.canonical?.matchup ??
                          swapMarketOption.eventTitle}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular">
                        {formatPercent(swapMarketOption.executablePriceBps)}
                      </p>
                      <p className="mt-0.5 text-[9px] text-positive">
                        Model{" "}
                        {formatPercent(
                          swapMarketOption.recommendedProbabilityBps,
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t pt-3 text-[9px]">
                    <span className="text-muted">
                      Score {swapMarketOption.lynervaScore ?? "n/a"}
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        (swapMarketOption.edgeBps ?? 0) > 0
                          ? "text-positive"
                          : "text-warning",
                      )}
                    >
                      {formatEdge(
                        (swapMarketOption.recommendedProbabilityBps ?? 0) -
                          (swapMarketOption.executablePriceBps ?? 0),
                      )}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] font-semibold text-accent">
                    Use this replacement
                    <ChevronRight size={11} />
                  </div>
                </button>
              ) : (
                <div className="rounded-2xl border bg-background p-7 text-center">
                  <p className="text-sm font-semibold">No exact fit found</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Try I don't care for direction. Huddlemark already searches
                    all alternate lines and best-available modeled markets.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedMarket ? (
        <BetLab
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      ) : null}
    </div>
  );
}
