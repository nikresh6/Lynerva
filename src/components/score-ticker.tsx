"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LiveNflGame } from "@/lib/nfl/live";
import { teamLogo } from "./subject-visual";

function matchupKey(game: LiveNflGame) {
  return [game.away.team, game.home.team].toSorted().join("-");
}

function statusLabel(game: LiveNflGame) {
  if (game.state === "in") {
    return game.clock ? `${game.status} · ${game.clock}` : game.status;
  }
  if (game.state === "post") return "Final";
  const start = new Date(game.startsAt);
  if (Number.isNaN(start.getTime())) return game.status;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function GameTickerItem({ game }: { game: LiveNflGame }) {
  const gameKey = matchupKey(game);
  const destination =
    game.state === "in"
      ? `/live?game=${encodeURIComponent(gameKey)}`
      : `/?game=${encodeURIComponent(gameKey)}`;

  return (
    <Link
      href={destination}
      className="score-ticker-item group flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2 transition-colors hover:border-accent/40 hover:bg-accent-bg/50"
      aria-label={`Open best bets for ${game.away.team} at ${game.home.team}`}
    >
      <div className="flex items-center gap-1.5">
        <img
          src={teamLogo(game.away.team)}
          alt=""
          className="size-5 object-contain"
        />
        <span className="text-[11px] font-semibold">{game.away.team}</span>
        {game.state !== "pre" ? (
          <span className="min-w-4 text-right text-[12px] font-bold tabular">
            {game.away.score}
          </span>
        ) : null}
      </div>

      <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-faint">
        {game.state === "pre" ? "at" : "vs"}
      </span>

      <div className="flex items-center gap-1.5">
        <img
          src={teamLogo(game.home.team)}
          alt=""
          className="size-5 object-contain"
        />
        <span className="text-[11px] font-semibold">{game.home.team}</span>
        {game.state !== "pre" ? (
          <span className="min-w-4 text-right text-[12px] font-bold tabular">
            {game.home.score}
          </span>
        ) : null}
      </div>

      <span
        className={
          game.state === "in"
            ? "rounded-full bg-negative-bg px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-negative"
            : "text-[9px] font-medium text-muted"
        }
      >
        {statusLabel(game)}
      </span>
    </Link>
  );
}

export function ScoreTicker() {
  const [games, setGames] = useState<LiveNflGame[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/live-nfl", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { games: LiveNflGame[] };
        if (!cancelled) setGames(payload.games);
      } catch {
        // Keep the last verified slate.
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const visible = useMemo(
    () =>
      games
        .filter((game) => game.home.team !== "—" && game.away.team !== "—")
        .toSorted((first, second) => {
          const stateRank = (state: string) =>
            state === "in" ? 0 : state === "pre" ? 1 : 2;
          const rankDiff = stateRank(first.state) - stateRank(second.state);
          if (rankDiff !== 0) return rankDiff;
          return (
            new Date(first.startsAt).getTime() -
            new Date(second.startsAt).getTime()
          );
        }),
    [games],
  );

  if (!visible.length) return null;

  const tickerGames = visible.length > 4 ? [...visible, ...visible] : visible;

  return (
    <div className="score-ticker-shell border-b bg-[var(--header)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1480px] items-center gap-3 overflow-hidden px-3 py-2 sm:px-6 lg:px-8">
        <div className="hidden shrink-0 items-center gap-2 pr-1 sm:flex">
          <span className="size-1.5 rounded-full bg-positive" />
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">
            NFL
          </span>
        </div>

        <div className="score-ticker-window min-w-0 flex-1 overflow-hidden">
          <div
            className={
              visible.length > 4
                ? "score-ticker-track score-ticker-track-moving flex w-max gap-2"
                : "score-ticker-track flex w-max gap-2"
            }
          >
            {tickerGames.map((game, index) => (
              <GameTickerItem key={`${game.id}:${index}`} game={game} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
