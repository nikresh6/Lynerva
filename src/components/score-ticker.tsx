"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LiveNflGame } from "@/lib/nfl/live";
import { teamLogo } from "./subject-visual";

function matchupKey(game: LiveNflGame) {
  return [game.away.team, game.home.team].toSorted().join("-");
}

function destinationFor(game: LiveNflGame) {
  const gameKey = matchupKey(game);
  return game.state === "in"
    ? `/live?game=${encodeURIComponent(gameKey)}`
    : `/?game=${encodeURIComponent(gameKey)}`;
}

function shortStatus(game: LiveNflGame) {
  if (game.state === "in") {
    const quarter = game.period > 4 ? "OT" : `Q${game.period}`;
    return game.clock ? `${quarter} ${game.clock}` : quarter;
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

function useTickerGames() {
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

  return useMemo(
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
}

function TeamScore({
  team,
  score,
  showScore,
}: {
  team: string;
  score: number;
  showScore: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <img
        src={teamLogo(team)}
        alt=""
        className="size-4 shrink-0 object-contain"
      />
      <span className="font-semibold">{team}</span>
      {showScore ? (
        <span className="min-w-3 text-right font-bold tabular">{score}</span>
      ) : null}
    </span>
  );
}

function TickerItem({
  game,
  mobile = false,
}: {
  game: LiveNflGame;
  mobile?: boolean;
}) {
  const showScore = game.state !== "pre";

  return (
    <Link
      href={destinationFor(game)}
      className={
        mobile
          ? "score-ticker-item-mobile flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] transition-colors hover:bg-surface"
          : "score-ticker-item-desktop flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[10px] transition-colors hover:bg-surface"
      }
      aria-label={`Open best bets for ${game.away.team} at ${game.home.team}`}
    >
      <TeamScore
        team={game.away.team}
        score={game.away.score}
        showScore={showScore}
      />
      <span className="text-[8px] font-medium uppercase tracking-[0.08em] text-faint">
        {showScore ? "vs" : "at"}
      </span>
      <TeamScore
        team={game.home.team}
        score={game.home.score}
        showScore={showScore}
      />
      <span
        className={
          game.state === "in"
            ? "rounded-full bg-negative-bg px-1.5 py-0.5 text-[8px] font-bold uppercase text-negative"
            : "whitespace-nowrap text-[8px] font-medium text-muted"
        }
      >
        {shortStatus(game)}
      </span>
    </Link>
  );
}

function Track({
  games,
  mobile = false,
}: {
  games: LiveNflGame[];
  mobile?: boolean;
}) {
  if (!games.length) return null;
  const repeated = games.length > (mobile ? 2 : 3);
  const items = repeated ? [...games, ...games] : games;

  return (
    <div className="score-ticker-window min-w-0 flex-1 overflow-hidden">
      <div
        className={
          repeated
            ? "score-ticker-track score-ticker-track-moving flex w-max items-center gap-1.5"
            : "score-ticker-track flex w-max items-center gap-1.5"
        }
      >
        {items.map((game, index) => (
          <TickerItem
            key={`${game.id}:${index}`}
            game={game}
            mobile={mobile}
          />
        ))}
      </div>
    </div>
  );
}

export function HeaderScoreTicker() {
  const games = useTickerGames();
  if (!games.length) return null;

  return (
    <>
      <div className="hidden min-w-0 flex-1 items-center lg:flex">
        <span className="mr-2 flex shrink-0 items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-faint">
          <span className="size-1.5 rounded-full bg-positive" />
          NFL
        </span>
        <Track games={games} />
      </div>

      <div className="score-ticker-mobile -mx-1 flex min-w-0 items-center overflow-hidden pb-2 sm:hidden">
        <Track games={games} mobile />
      </div>
    </>
  );
}
