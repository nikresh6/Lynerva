"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { LiveNflGame } from "@/lib/nfl/live";
import type { MarketOpportunity } from "@/lib/markets/types";
import { formatPercent, titleCase } from "@/lib/utils";
import { BetLab } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { PlatformMark } from "./platform-mark";
import { usePlayerVisuals } from "./player-visuals";
import { SubjectVisual, teamLogo } from "./subject-visual";

function normalizeMatchup(value: string | null | undefined) {
  if (!value) return "";
  return value
    .split(/[^A-Za-z]+/)
    .map((team) => team.trim().toUpperCase())
    .filter(Boolean)
    .map((team) => (team === "WSH" ? "WAS" : team))
    .toSorted()
    .join("-");
}

function matchupKey(game: LiveNflGame) {
  return normalizeMatchup(`${game.away.team}-${game.home.team}`);
}

function pickSide(market: MarketOpportunity) {
  if (!market.recommendedSide) return "No pick";
  const direction = market.canonical?.direction;
  if (market.recommendedSide === "yes") {
    if (direction === "over") return "Over";
    if (direction === "under") return "Under";
    return "Yes";
  }
  if (direction === "over") return "Under";
  if (direction === "under") return "Over";
  return "No";
}

function marketTitle(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.marketTitle;

  const labels: Record<string, string> = {
    passing_yards: "passing yards",
    passing_touchdowns: "passing TDs",
    passing_interceptions: "interceptions",
    rushing_yards: "rushing yards",
    receiving_yards: "receiving yards",
    receptions: "receptions",
    longest_reception: "longest reception",
    touchdowns: "touchdowns",
  };
  const label = labels[canonical.family] ?? titleCase(canonical.family);

  if (canonical.threshold !== null) {
    if (
      canonical.family === "touchdowns" &&
      canonical.direction === "over" &&
      Number.isInteger(canonical.threshold)
    ) {
      return `${canonical.subject} ${canonical.threshold}+ ${label}`;
    }
    return `${canonical.subject} ${canonical.threshold} ${label}`;
  }

  return market.marketTitle;
}

function edgeLabel(market: MarketOpportunity) {
  if (market.edgeBps === null) return "No edge";
  const edge = market.edgeBps / 100;
  return `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}pp`;
}

function gameStatus(game: LiveNflGame) {
  if (game.state === "in") {
    const quarter = game.period > 4 ? "OT" : `Q${game.period}`;
    return game.clock ? `${quarter} · ${game.clock}` : quarter;
  }
  if (game.state === "post") return "Final";

  const start = new Date(game.startsAt);
  if (Number.isNaN(start.getTime())) return game.status;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function groupBestMarkets(markets: MarketOpportunity[]) {
  const groups = new Map<string, MarketOpportunity>();

  for (const market of markets.toSorted(
    (a, b) => (b.lynervaScore ?? -1) - (a.lynervaScore ?? -1),
  )) {
    const canonical = market.canonical;
    const key = canonical
      ? [
          canonical.matchup,
          canonical.family,
          canonical.subject,
          canonical.statistic ?? "",
          market.recommendedSide ?? "",
        ].join(":")
      : `${market.platform}:${market.platformMarketId}`;

    if (!groups.has(key)) groups.set(key, market);
  }

  return [...groups.values()].slice(0, 8);
}

function TeamLine({
  team,
  score,
  showScore,
}: {
  team: string;
  score: number;
  showScore: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-background p-1.5">
        <img src={teamLogo(team)} alt="" className="size-full object-contain" />
      </span>
      <span className="truncate text-[15px] font-semibold">{team}</span>
      {showScore ? (
        <span className="ml-auto text-lg font-bold tabular">{score}</span>
      ) : null}
    </div>
  );
}

function BetRow({
  market,
  visual,
  onOpen,
}: {
  market: MarketOpportunity;
  visual: ReturnType<typeof usePlayerVisuals>[string];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-background sm:px-5"
    >
      <SubjectVisual market={market} visual={visual} size="sm" />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PlatformMark platform={market.platform} />
          {market.isLive ? (
            <span className="rounded-full bg-negative-bg px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-negative">
              Live
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 truncate text-[13px] font-semibold">
          <span className="mr-1.5 text-positive">{pickSide(market)}</span>
          {marketTitle(market)}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-faint">
          <span>Market {formatPercent(market.executablePriceBps)}</span>
          <span>Lynerva {formatPercent(market.recommendedProbabilityBps)}</span>
          <span>{edgeLabel(market)} edge</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 pl-2">
        <div className="text-right">
          <div className="text-lg font-bold leading-none tabular">
            {market.lynervaScore ?? "—"}
          </div>
          <div className="mt-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-faint">
            Score
          </div>
        </div>
        <ArrowUpRight
          size={14}
          className="text-faint transition-colors group-hover:text-foreground"
        />
      </div>
    </button>
  );
}

export function GameBetsModal({
  game,
  onClose,
}: {
  game: LiveNflGame;
  onClose: () => void;
}) {
  const { opportunities, loading, refreshing } = useMarketData();
  const [selectedBet, setSelectedBet] = useState<MarketOpportunity | null>(null);
  const targetMatchup = matchupKey(game);
  const liveOnly = game.state === "in";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !selectedBet) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose, selectedBet]);

  const gameMarkets = useMemo(() => {
    const matching = opportunities.filter((market) => {
      if (normalizeMatchup(market.canonical?.matchup) !== targetMatchup) {
        return false;
      }
      if (market.lynervaScore === null || market.recommendedSide === null) {
        return false;
      }
      return liveOnly ? market.isLive : !market.isLive;
    });

    return groupBestMarkets(matching);
  }, [liveOnly, opportunities, targetMatchup]);

  const playerNames = useMemo(
    () =>
      gameMarkets
        .map((market) => market.canonical?.subject ?? "")
        .filter(Boolean),
    [gameMarkets],
  );
  const visuals = usePlayerVisuals(playerNames);

  const destination = liveOnly
    ? `/live?game=${encodeURIComponent(targetMatchup)}`
    : `/?game=${encodeURIComponent(targetMatchup)}`;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center p-2 sm:items-center sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-label={`Best bets for ${game.away.team} at ${game.home.team}`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-[var(--overlay)]"
          aria-label="Close game bets"
          onClick={onClose}
        />

        <section className="relative flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px] border bg-surface shadow-[0_24px_80px_rgb(0_0_0/0.26)] sm:max-h-[82vh]">
          <header className="border-b px-4 py-4 sm:px-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                  {liveOnly ? (
                    <span className="inline-flex items-center gap-1.5 text-negative">
                      <span className="size-1.5 rounded-full bg-negative" />
                      Live
                    </span>
                  ) : (
                    <span>Game board</span>
                  )}
                  <span className="text-faint">{gameStatus(game)}</span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:gap-5">
                  <TeamLine
                    team={game.away.team}
                    score={game.away.score}
                    showScore={game.state !== "pre"}
                  />
                  <TeamLine
                    team={game.home.team}
                    score={game.home.score}
                    showScore={game.state !== "pre"}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="flex items-center justify-between border-b bg-background/55 px-4 py-2.5 sm:px-5">
            <div>
              <div className="text-xs font-semibold">
                {liveOnly ? "Best live bets" : "Best bets"}
              </div>
              <div className="mt-0.5 text-[10px] text-faint">
                Ranked by Lynerva Score for this game only
              </div>
            </div>
            {refreshing ? (
              <span className="text-[9px] font-medium text-muted">Refreshing</span>
            ) : null}
          </div>

          <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
            {loading && opportunities.length === 0 ? (
              <div className="space-y-0">
                {[0, 1, 2, 3].map((value) => (
                  <div
                    key={value}
                    className="flex items-center gap-3 border-b px-4 py-4 sm:px-5"
                  >
                    <div className="size-9 animate-pulse rounded-xl bg-border" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-border" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded bg-border" />
                    </div>
                    <div className="size-8 animate-pulse rounded bg-border" />
                  </div>
                ))}
              </div>
            ) : gameMarkets.length ? (
              gameMarkets.map((market) => (
                <BetRow
                  key={`${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`}
                  market={market}
                  visual={visuals[market.canonical?.subject ?? ""]}
                  onOpen={() => setSelectedBet(market)}
                />
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <div className="text-sm font-semibold">
                  {liveOnly
                    ? "No rated live bets for this game right now."
                    : "No rated bets for this game right now."}
                </div>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted">
                  Lynerva only shows markets with a model-backed probability and an executable price.
                </p>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <span className="text-[10px] text-faint">
              {gameMarkets.length
                ? `Showing top ${gameMarkets.length}`
                : "Game-specific market view"}
            </span>
            <Link
              href={destination}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors hover:bg-background"
            >
              Open full game board
              <ArrowUpRight size={12} />
            </Link>
          </footer>
        </section>
      </div>

      {selectedBet ? (
        <BetLab market={selectedBet} onClose={() => setSelectedBet(null)} />
      ) : null}
    </>
  );
}
