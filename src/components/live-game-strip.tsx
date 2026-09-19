"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LiveNflGame } from "@/lib/nfl/live";
import { teamLogo } from "./subject-visual";

function gameLabel(game: LiveNflGame) {
  if (game.state === "in") return game.status;
  const start = new Date(game.startsAt);
  if (Number.isNaN(start.getTime())) return game.status;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

export function LiveGameStrip({ games }: { games: LiveNflGame[] }) {
  const [current, setCurrent] = useState(games);

  useEffect(() => {
    setCurrent(games);
  }, [games]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/live-nfl", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { games: LiveNflGame[] };
        if (!cancelled) setCurrent(payload.games);
      } catch {
        // Keep the last good scoreboard state.
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 3_000);
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

  const visible = useMemo(() => {
    const now = Date.now();
    const live = current.filter((game) => game.state === "in");
    if (live.length) return live;

    return current.filter((game) => {
      if (game.state !== "pre") return false;
      const start = new Date(game.startsAt).getTime();
      return Number.isFinite(start) && start >= now && start - now <= 12 * 60 * 60 * 1_000;
    });
  }, [current]);

  if (!visible.length) return null;

  return (
    <div className="scrollbar-subtle -mx-1 mb-4 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
      {visible.map((game) => {
        const gameKey = [game.away.team, game.home.team].toSorted().join("-");
        const destination =
          game.state === "in"
            ? `/live?game=${encodeURIComponent(gameKey)}`
            : `/?game=${encodeURIComponent(gameKey)}`;

        return (
        <Link
          key={game.id}
          href={destination}
          className="premium-panel group min-w-[232px] snap-start overflow-hidden rounded-2xl transition-all hover:border-accent/35 hover:shadow-[0_14px_36px_var(--accent-glow)] sm:min-w-[260px]"
          aria-label={`Open best bets for ${game.away.team} at ${game.home.team}`}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5 text-[10px] text-muted">
            <span>{gameLabel(game)}</span>
            <span
              className={
                game.state === "in"
                  ? "live-badge rounded-full bg-negative-bg px-2 py-0.5 font-semibold text-negative"
                  : "rounded-full bg-accent-bg px-2 py-0.5 font-semibold text-accent"
              }
            >
              {game.state === "in" ? game.clock : "NFL"}
            </span>
          </div>
          <div className="space-y-2.5 px-4 py-3.5">
            {[
              [game.away.team, game.away.score],
              [game.home.team, game.home.score],
            ].map(([team, score]) => (
              <div
                key={team}
                className="flex items-center justify-between font-medium tabular"
              >
                <span className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg border bg-surface p-1">
                    <img
                      src={teamLogo(String(team))}
                      alt=""
                      className="size-full object-contain"
                    />
                  </span>
                  {team}
                </span>
                <span className="text-base font-semibold">
                  {game.state === "in" ? score : "—"}
                </span>
              </div>
            ))}
            {game.state === "in" && game.possession ? (
              <p className="border-t pt-2 text-[10px] text-faint">
                Possession: {game.possession}
              </p>
            ) : null}
          </div>
        </Link>
        );
      })}
    </div>
  );
}
