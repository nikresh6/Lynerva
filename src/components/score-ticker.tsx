"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import Image from "next/image";
import type { LiveNflGame } from "@/lib/nfl/live";
import { teamLogo } from "./subject-visual";

function matchupKey(game: LiveNflGame) {
  return [game.away.team, game.home.team].toSorted().join("-");
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

export function useTickerGames() {
  const pathname = usePathname();
  const [games, setGames] = useState<LiveNflGame[]>([]);
  // Live and Games already own a faster scoreboard. Avoid running a second
  // header poll on those routes.
  const enabled = ["/", "/builder", "/tracker"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

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
  }, [enabled]);

  return useMemo(
    () =>
      enabled
        ? games
            .filter(
              (game) => game.home.team !== "—" && game.away.team !== "—",
            )
            .toSorted((first, second) => {
              const stateRank = (state: string) =>
                state === "in" ? 0 : state === "pre" ? 1 : 2;
              const rankDiff =
                stateRank(first.state) - stateRank(second.state);
              if (rankDiff !== 0) return rankDiff;
              return (
                new Date(first.startsAt).getTime() -
                new Date(second.startsAt).getTime()
              );
            })
        : [],
    [enabled, games],
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
      <Image
        unoptimized
        src={teamLogo(team)}
        alt=""
        width={16}
        height={16}
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
  onOpen,
}: {
  game: LiveNflGame;
  onOpen: (game: LiveNflGame) => void;
}) {
  const showScore = game.state !== "pre";

  return (
    <button
      type="button"
      onClick={() => onOpen(game)}
      className="score-ticker-item flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] transition-colors hover:bg-surface"
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
    </button>
  );
}

export function ScoreTicker({ games }: { games: LiveNflGame[] }) {
  const router = useRouter();
  if (!games.length) return null;
  const openGame = (game: LiveNflGame) =>
    router.push(`/games?game=${encodeURIComponent(matchupKey(game))}`);

  // A score strip is navigation, not a second scoreboard. Keeping the most
  // relevant eight games makes it quick to scan and prevents hidden duplicate
  // marquees from adding hundreds of DOM nodes on every route.
  const visible = games.slice(0, 8);

  return (
    <div className="score-ticker-responsive order-3 -mx-1 flex w-full min-w-0 items-center overflow-hidden pb-2 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:pb-0">
      <span className="mr-2 flex shrink-0 items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-faint">
        <span className="size-1.5 rounded-full bg-positive" />
        NFL
      </span>
      <div className="scrollbar-subtle min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div className="flex w-max items-center gap-1.5">
          {visible.map((game) => (
            <TickerItem key={game.id} game={game} onOpen={openGame} />
          ))}
        </div>
      </div>
    </div>
  );
}
