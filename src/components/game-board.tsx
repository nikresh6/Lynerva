"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Layers3,
  Radio,
  Sparkles,
} from "lucide-react";
import { buildRankedCombinations } from "@/lib/builder";
import { isBuilderEligibleOpportunity } from "@/lib/markets/eligibility";
import type { MarketOpportunity } from "@/lib/markets/types";
import type { LiveNflGame } from "@/lib/nfl/live";
import { getNflTeam } from "@/lib/nfl/teams";
import { cn, formatPercent } from "@/lib/utils";
import { BetLab, MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { usePlayerVisuals } from "./player-visuals";
import { SubjectVisual, teamLogo } from "./subject-visual";

function canonicalTeamCode(code: string) {
  const upper = code.toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function normalizeMatchup(value: string | null | undefined) {
  if (!value) return "";
  return value
    .split("-")
    .map(canonicalTeamCode)
    .toSorted()
    .join("-");
}

function keyFor(game: LiveNflGame) {
  return normalizeMatchup(`${game.away.team}-${game.home.team}`);
}

function status(game: LiveNflGame) {
  if (game.state === "in") {
    const q = game.period > 4 ? "OT" : `Q${game.period}`;
    return game.clock ? `${q} · ${game.clock}` : q;
  }
  if (game.state === "post") return "Final";
  const date = new Date(game.startsAt);
  return Number.isNaN(date.getTime())
    ? game.status
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function teamName(code: string) {
  return getNflTeam(canonicalTeamCode(code))?.fullName ?? code;
}

function pickLabel(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.marketTitle;
  const takingContract = market.recommendedSide !== "no";
  const direction = takingContract
    ? canonical.direction
    : canonical.direction === "over"
      ? "under"
      : canonical.direction === "under"
        ? "over"
        : canonical.direction;
  const family = canonical.family.replaceAll("_", " ");
  return `${canonical.subject} · ${direction === "over" ? "Over" : direction === "under" ? "Under" : direction.toUpperCase()} ${canonical.threshold ?? ""} ${family}`.trim();
}

function SlateTab({
  game,
  active,
  onClick,
}: {
  game: LiveNflGame;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group min-w-[148px] shrink-0 rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "border-accent/40 bg-accent-bg shadow-[0_8px_24px_var(--accent-glow)]"
          : "bg-surface hover:border-border-strong hover:bg-surface-raised",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {[game.away.team, game.home.team].map((team) => (
            <span
              key={team}
              className="grid size-7 place-items-center rounded-full border bg-background p-1"
            >
              <img
                src={teamLogo(team)}
                alt=""
                className="size-full object-contain"
              />
            </span>
          ))}
        </div>
        {game.state === "in" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-negative-bg px-1.5 py-0.5 text-[8px] font-bold uppercase text-negative">
            <Radio size={8} className="animate-pulse" />
            Live
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-[11px] font-semibold">
        {game.away.team} at {game.home.team}
      </div>
      <div className="mt-0.5 text-[9px] text-faint">{status(game)}</div>
    </button>
  );
}

function TeamHero({
  code,
  score,
  showScore,
}: {
  code: string;
  score: number;
  showScore: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center text-center">
      <span className="grid size-16 place-items-center rounded-2xl border bg-background p-2 shadow-[0_12px_32px_rgb(0_0_0/0.08)] sm:size-20">
        <img src={teamLogo(code)} alt="" className="size-full object-contain" />
      </span>
      <div className="mt-3 text-sm font-semibold sm:text-base">
        {teamName(code)}
      </div>
      {showScore ? (
        <div className="mt-1 text-3xl font-bold tabular sm:text-4xl">{score}</div>
      ) : (
        <div className="mt-1 text-xs font-medium text-muted">{code}</div>
      )}
    </div>
  );
}

export function GameBoard() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("game")?.toUpperCase() ?? "";
  const { opportunities, loading, refreshing, refresh } = useMarketData();
  const [games, setGames] = useState<LiveNflGame[]>([]);
  const [selectedMarket, setSelectedMarket] =
    useState<MarketOpportunity | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/live-nfl", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { games: LiveNflGame[] };
        if (!cancelled) setGames(payload.games);
      } catch {}
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const slate = useMemo(
    () =>
      games
        .filter((game) => game.state !== "post")
        .toSorted(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        ),
    [games],
  );

  const selectedIndex = Math.max(
    0,
    slate.findIndex((game) => keyFor(game) === requested),
  );
  const game = slate[selectedIndex] ?? null;

  useEffect(() => {
    if (!game || requested) return;
    router.replace(`/games?game=${encodeURIComponent(keyFor(game))}`);
  }, [game, requested, router]);

  useEffect(() => {
    if (game?.state !== "in") return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [game?.id, game?.state]);

  const markets = useMemo(() => {
    if (!game) return [];
    const target = keyFor(game);
    return opportunities.filter(
      (market) =>
        normalizeMatchup(market.canonical?.matchup) === target &&
        market.lynervaScore !== null &&
        market.recommendedSide !== null &&
        (game.state === "in" ? market.isLive : !market.isLive),
    );
  }, [game, opportunities]);

  const sgps = useMemo(() => {
    if (!game) return [];
    const eligible = markets.filter(isBuilderEligibleOpportunity);
    if (eligible.length < 2) return [];
    return buildRankedCombinations(
      eligible,
      {
        minReturn: 1.8,
        maxReturn: 35,
        maxLegs: 5,
        platform: "kalshi",
        live: game.state === "in" ? "live" : "pregame",
        mode: "sgp",
        objective: "balanced",
      },
      3,
    );
  }, [game, markets]);

  const sgpPlayerNames = useMemo(
    () =>
      sgps
        .flatMap((parlay) => parlay.legs)
        .map((market) => market.canonical?.subject ?? "")
        .filter(Boolean),
    [sgps],
  );
  const visuals = usePlayerVisuals(sgpPlayerNames);

  const choose = (next: LiveNflGame) =>
    router.replace(`/games?game=${encodeURIComponent(keyFor(next))}`);

  if (!game) {
    return (
      <div className="premium-panel rounded-2xl px-6 py-20 text-center">
        <div className="mx-auto size-8 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
        <div className="mt-4 text-sm font-semibold">Loading NFL slate...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="premium-panel overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-5">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => choose(slate[selectedIndex - 1]!)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:bg-background disabled:opacity-25"
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <div className="text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            NFL game board · {selectedIndex + 1} of {slate.length}
          </div>
          <button
            type="button"
            disabled={selectedIndex >= slate.length - 1}
            onClick={() => choose(slate[selectedIndex + 1]!)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:bg-background disabled:opacity-25"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>

        <div className="scrollbar-subtle flex gap-2 overflow-x-auto border-b bg-background/35 p-2.5">
          {slate.map((item) => (
            <SlateTab
              key={item.id}
              game={item}
              active={item.id === game.id}
              onClick={() => choose(item)}
            />
          ))}
        </div>

        <div className="relative overflow-hidden px-4 py-6 sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_center,var(--accent-glow),transparent_68%)] opacity-70" />
          <div className="relative mx-auto flex max-w-3xl items-center justify-center gap-5 sm:gap-10">
            <TeamHero
              code={game.away.team}
              score={game.away.score}
              showScore={game.state !== "pre"}
            />
            <div className="shrink-0 text-center">
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-[10px] font-semibold",
                  game.state === "in" ? "text-negative" : "text-muted",
                )}
              >
                {game.state === "in" ? (
                  <Radio size={11} className="animate-pulse" />
                ) : (
                  <Clock3 size={11} />
                )}
                {status(game)}
              </div>
              <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-faint">
                {game.away.team} at {game.home.team}
              </div>
              {refreshing ? (
                <div className="mt-2 text-[9px] text-faint">Refreshing odds</div>
              ) : null}
            </div>
            <TeamHero
              code={game.home.team}
              score={game.home.score}
              showScore={game.state !== "pre"}
            />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers3 size={16} className="text-accent" />
              <h2 className="text-lg font-semibold tracking-tight">
                Same-game builds
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted">
              Three diversified SGP ideas built only from this matchup.
            </p>
          </div>
          <span className="hidden rounded-full border bg-surface px-2.5 py-1 text-[9px] font-semibold text-faint sm:inline-flex">
            Kalshi only
          </span>
        </div>

        {sgps.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {sgps.map((parlay, index) => (
              <article
                key={parlay.legs
                  .map((leg) => leg.platformMarketId)
                  .join("|")}
                className="premium-panel overflow-hidden rounded-2xl"
              >
                <div className="flex items-start justify-between gap-3 border-b bg-surface-raised/40 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center rounded-lg bg-accent-bg text-[10px] font-bold text-accent">
                        {index + 1}
                      </span>
                      <span className="text-xs font-semibold">Featured SGP</span>
                    </div>
                    <div className="mt-3 text-2xl font-semibold tabular">
                      {parlay.grossReturn.toFixed(2)}x
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      {formatPercent(
                        Math.round(parlay.estimatedProbability * 10_000),
                        1,
                      )} model hit chance
                    </div>
                  </div>
                  <div className="rounded-xl border bg-background px-3 py-2 text-center">
                    <div className="text-lg font-bold tabular">
                      {parlay.lynervaScore}
                    </div>
                    <div className="text-[7px] font-semibold uppercase tracking-[0.1em] text-faint">
                      Parlay score
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 p-2.5">
                  {parlay.legs.map((leg) => (
                    <button
                      key={leg.platformMarketId}
                      type="button"
                      onClick={() => setSelectedMarket(leg)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-background"
                    >
                      <SubjectVisual
                        market={leg}
                        visual={visuals[leg.canonical?.subject ?? ""]}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold">
                          {pickLabel(leg)}
                        </div>
                        <div className="mt-0.5 text-[9px] text-faint">
                          Market {formatPercent(leg.executablePriceBps)} · Lynerva{" "}
                          {formatPercent(leg.recommendedProbabilityBps)}
                        </div>
                      </div>
                      <Sparkles size={12} className="shrink-0 text-faint" />
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="premium-panel rounded-2xl px-5 py-8 text-center">
            <p className="text-sm font-semibold">No clean SGP yet</p>
            <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
              Lynerva waits until this game has at least two independently
              modeled, executable legs that can form a reasonable same-game
              combination.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {game.state === "in" ? "Best live bets" : "Best bets"}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {game.away.team} at {game.home.team}, ranked by Lynerva Score.
          </p>
        </div>

        {loading && !opportunities.length ? (
          <div className="premium-panel rounded-2xl px-6 py-16 text-center">
            <div className="mx-auto size-7 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
            <p className="mt-3 text-sm font-medium">Loading game markets...</p>
          </div>
        ) : (
          <MarketTable
            markets={markets}
            emptyMessage={
              game.state === "in"
                ? "No rated live bets for this game right now."
                : "No rated bets for this game right now."
            }
          />
        )}
      </section>

      {selectedMarket ? (
        <BetLab
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      ) : null}
    </div>
  );
}
