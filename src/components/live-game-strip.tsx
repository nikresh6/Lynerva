"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveNflGame } from "@/lib/nfl/live";

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
    <div className="scrollbar-subtle mb-4 flex gap-2 overflow-x-auto pb-1">
      {visible.map((game) => (
        <div
          key={game.id}
          className="min-w-[220px] rounded-xl border bg-surface px-3.5 py-3"
        >
          <div className="mb-2 flex items-center justify-between text-[10px] text-muted">
            <span>{gameLabel(game)}</span>
            <span>{game.state === "in" ? game.clock : "NFL"}</span>
          </div>
          <div className="flex items-center justify-between font-medium tabular">
            <span>{game.away.team}</span>
            <span>{game.state === "in" ? game.away.score : "—"}</span>
          </div>
          <div className="mt-1 flex items-center justify-between font-medium tabular">
            <span>{game.home.team}</span>
            <span>{game.state === "in" ? game.home.score : "—"}</span>
          </div>
          {game.state === "in" && game.possession ? (
            <p className="mt-2 text-[10px] text-faint">
              Possession: {game.possession}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
