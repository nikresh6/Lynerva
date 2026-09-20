"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Sparkles, Target, Zap } from "lucide-react";
import type { LiveNflGame } from "@/lib/nfl/live";
import type { MarketOpportunity } from "@/lib/markets/types";
import { buildRankedCombinations } from "@/lib/builder";
import { cn, formatPercent } from "@/lib/utils";
import { BetLab, MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { SubjectVisual, teamLogo } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

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
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function Team({
  code,
  score,
  showScore,
}: {
  code: string;
  score: number;
  showScore: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-10 place-items-center rounded-xl border bg-surface p-1.5">
        <img src={teamLogo(code)} alt="" className="size-full object-contain" />
      </span>
      <span className="text-base font-semibold">{code}</span>
      {showScore ? <span className="text-xl font-bold tabular">{score}</span> : null}
    </div>
  );
}

function SgpScore({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, score));
  return (
    <div
      className="score-ring grid size-12 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(from -90deg, var(--accent) 0deg ${value * 3.6}deg, var(--border) ${value * 3.6}deg 360deg)`,
      }}
    >
      <div className="grid size-[82%] place-items-center rounded-full bg-surface text-sm font-bold tabular">
        {score}
      </div>
    </div>
  );
}

export function GameBoard() {
  const params = useSearchParams();
  const requested = params.get("game")?.toUpperCase() ?? "";
  const { opportunities, loading, refreshing, refresh } = useMarketData();
  const [games, setGames] = useState<LiveNflGame[]>([]);
  const [selectedKey, setSelectedKey] = useState(requested);
  const [selectedMarket, setSelectedMarket] = useState<MarketOpportunity | null>(null);

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

  useEffect(() => {
    if (requested) setSelectedKey(requested);
  }, [requested]);

  const selectedIndex = Math.max(
    0,
    slate.findIndex((game) => keyFor(game) === selectedKey),
  );
  const game = slate[selectedIndex] ?? null;

  useEffect(() => {
    if (!game || selectedKey) return;
    const key = keyFor(game);
    setSelectedKey(key);
    window.history.replaceState(
      window.history.state,
      "",
      `/games?game=${encodeURIComponent(key)}`,
    );
  }, [game, selectedKey]);

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
    if (!markets.length) return [];

    const configs = [
      {
        key: "best",
        label: "BEST",
        detail: "Best overall setup",
        icon: Sparkles,
        objective: "balanced" as const,
        minReturn: 1.5,
        maxReturn: 4.5,
        maxLegs: 4,
      },
      {
        key: "value",
        label: "VALUE",
        detail: "More payout, still model-backed",
        icon: Target,
        objective: "max_ev" as const,
        minReturn: 3,
        maxReturn: 10,
        maxLegs: 5,
      },
      {
        key: "hail",
        label: "HAIL MARY",
        detail: "Small stake, high upside",
        icon: Zap,
        objective: "max_ev" as const,
        minReturn: 10,
        maxReturn: 60,
        maxLegs: 7,
      },
    ];

    return configs.map((config) => {
      const build = buildRankedCombinations(
        markets,
        {
          minReturn: config.minReturn,
          maxReturn: config.maxReturn,
          maxLegs: config.maxLegs,
          platform: "kalshi",
          live: game?.state === "in" ? "live" : "pregame",
          mode: "sgp",
          objective: config.objective,
        },
        1,
      )[0] ?? null;

      return { ...config, build };
    });
  }, [game?.state, markets]);

  const choose = (next: LiveNflGame) => {
    const key = keyFor(next);
    // Switch immediately from already-loaded game and market data. Updating the
    // URL with history.replaceState avoids a Next navigation round trip.
    setSelectedKey(key);
    setSelectedMarket(null);
    window.history.replaceState(
      window.history.state,
      "",
      `/games?game=${encodeURIComponent(key)}`,
    );
  };

  const sgpPlayerNames = useMemo(
    () =>
      sgps.flatMap((row) =>
        row.build?.legs
          .map((leg) => leg.canonical?.subject ?? "")
          .filter(Boolean) ?? [],
      ),
    [sgps],
  );
  const sgpVisuals = usePlayerVisuals(sgpPlayerNames);

  if (!game) {
    return (
      <div className="premium-panel rounded-2xl px-6 py-20 text-center">
        <div className="text-sm font-semibold">Loading NFL games...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="premium-panel game-hero overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-5">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => choose(slate[selectedIndex - 1]!)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:bg-background disabled:opacity-25"
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <div className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {selectedIndex + 1} of {slate.length}
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

        <div className="scrollbar-subtle flex gap-1.5 overflow-x-auto border-b p-2">
          {slate.map((item) => {
            const active = item.id === game.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => choose(item)}
                className={
                  active
                    ? "shrink-0 rounded-lg border bg-background px-3 py-2 text-[10px] font-semibold"
                    : "shrink-0 rounded-lg border border-transparent px-3 py-2 text-[10px] font-medium text-muted hover:bg-background"
                }
              >
                {item.away.team} · {item.home.team}
              </button>
            );
          })}
        </div>

        <div className="grid items-center gap-4 px-4 py-5 sm:grid-cols-[1fr_auto_1fr] sm:px-7">
          <div className="sm:justify-self-end">
            <Team
              code={game.away.team}
              score={game.away.score}
              showScore={game.state !== "pre"}
            />
          </div>
          <div className="text-center">
            <div className={game.state === "in" ? "text-xs font-bold text-negative" : "text-xs font-semibold text-muted"}>
              {status(game)}
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-faint">
              {game.state === "in" ? "Live game" : "NFL"}
            </div>
          </div>
          <Team
            code={game.home.team}
            score={game.home.score}
            showScore={game.state !== "pre"}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
              <Sparkles className="size-3.5" />
              Same-game parlays
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Three ways to play this game
            </h2>
          </div>
          <span className="hidden text-[10px] text-faint sm:block">
            Kalshi markets only
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {sgps.map((row) => {
            const Icon = row.icon;
            const build = row.build;
            return (
              <details
                key={row.key}
                className={cn(
                  "sgp-card group overflow-hidden rounded-2xl border bg-surface",
                  row.key === "best"
                    ? "sgp-card-best"
                    : row.key === "value"
                      ? "sgp-card-value"
                      : "sgp-card-hail",
                )}
              >
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-xl border bg-background">
                          <Icon className="size-3.5" />
                        </span>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-accent">
                            {row.label}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold">
                            {row.detail}
                          </p>
                        </div>
                      </div>
                      {build ? (
                        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-2">
                          <div>
                            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                              Return
                            </p>
                            <p className="mt-1 text-xl font-bold tabular">
                              {build.grossReturn.toFixed(2)}x
                            </p>
                          </div>
                          <div>
                            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                              Est. chance
                            </p>
                            <p className="mt-1 text-sm font-semibold tabular">
                              {formatPercent(
                                Math.round(build.estimatedProbability * 10_000),
                                1,
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                              Legs
                            </p>
                            <p className="mt-1 text-sm font-semibold tabular">
                              {build.legs.length}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-[11px] leading-5 text-muted">
                          No model-backed SGP currently fits this payout band.
                        </p>
                      )}
                    </div>
                    {build ? <SgpScore score={build.lynervaScore} /> : null}
                  </div>

                  {build ? (
                    <div className="mt-3 flex items-center justify-between border-t pt-3 text-[9px] font-medium text-muted">
                      <span>Open legs</span>
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                    </div>
                  ) : null}
                </summary>

                {build ? (
                  <div className="border-t bg-background/45 p-3">
                    <ol className="space-y-1.5">
                      {build.legs.map((leg, index) => {
                        const subject = leg.canonical?.subject ?? "";
                        return (
                          <li key={`${leg.platformMarketId}:${index}`}>
                            <button
                              type="button"
                              onClick={() => setSelectedMarket(leg)}
                              className="group/leg flex w-full items-center gap-3 rounded-xl border bg-surface px-2.5 py-2 text-left transition-all hover:border-accent/35 hover:bg-surface-raised"
                            >
                              <SubjectVisual
                                market={leg}
                                visual={sgpVisuals[subject]}
                                size="sm"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[10px] font-semibold leading-4">
                                  {leg.marketTitle}
                                </span>
                                <span className="mt-0.5 block text-[9px] text-muted">
                                  Market {formatPercent(leg.executablePriceBps)} · Lynerva{" "}
                                  {formatPercent(leg.recommendedProbabilityBps)}
                                </span>
                              </span>
                              <span className="shrink-0 rounded-lg border bg-background px-2 py-1 text-[10px] font-bold tabular transition-colors group-hover/leg:border-accent/35">
                                {leg.lynervaScore ?? "—"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      </section>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {game.state === "in" ? "Best live bets" : "Best bets"}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {game.away.team} at {game.home.team}, ranked by Lynerva Score.
          </p>
        </div>
        {refreshing ? <span className="text-[10px] text-faint">Refreshing</span> : null}
      </div>

      {loading && !opportunities.length ? (
        <div className="premium-panel rounded-2xl px-6 py-16 text-center text-sm text-muted">
          Loading markets...
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

      {selectedMarket ? (
        <BetLab market={selectedMarket} onClose={() => setSelectedMarket(null)} />
      ) : null}
    </div>
  );
}
