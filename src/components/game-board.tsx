"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LiveNflGame } from "@/lib/nfl/live";
import type { MarketOpportunity } from "@/lib/markets/types";
import { MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { teamLogo } from "./subject-visual";

function keyFor(game: LiveNflGame) {
  return [game.away.team, game.home.team].toSorted().join("-");
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

export function GameBoard() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("game")?.toUpperCase() ?? "";
  const { opportunities, loading, refreshing, refresh } = useMarketData();
  const [games, setGames] = useState<LiveNflGame[]>([]);

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
        market.canonical?.matchup === target &&
        market.lynervaScore !== null &&
        market.recommendedSide !== null &&
        (game.state === "in" ? market.isLive : !market.isLive),
    );
  }, [game, opportunities]);

  const choose = (next: LiveNflGame) =>
    router.replace(`/games?game=${encodeURIComponent(keyFor(next))}`);

  if (!game) {
    return (
      <div className="premium-panel rounded-2xl px-6 py-20 text-center">
        <div className="text-sm font-semibold">Loading NFL games...</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="premium-panel overflow-hidden rounded-2xl">
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
    </div>
  );
}
