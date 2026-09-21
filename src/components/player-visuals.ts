"use client";

import { useEffect, useMemo, useState } from "react";

export interface PlayerVisualData {
  imageUrl: string | null;
  team: string | null;
  position: string | null;
}

const cache = new Map<string, PlayerVisualData | null>();

export function usePlayerVisuals(names: string[]) {
  const namesKey = names.join("|");
  const stableNames = useMemo(
    () =>
      [
        ...new Set(
          namesKey
            .split("|")
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ].toSorted(),
    [namesKey],
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const missing = stableNames.filter((name) => !cache.has(name));
    if (!missing.length) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ names: missing.join("|") });

    fetch(`/api/player-visuals?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(
        (payload: {
          players: Record<string, PlayerVisualData | null>;
        }) => {
          for (const name of missing) {
            cache.set(name, payload.players[name] ?? null);
          }
          setVersion((current) => current + 1);
        },
      )
      .catch(() => {
        if (controller.signal.aborted) return;
        for (const name of missing) cache.set(name, null);
        setVersion((current) => current + 1);
      });

    return () => controller.abort();
  }, [stableNames]);

  return useMemo(() => {
    // The cache is external to React; version invalidates this snapshot after a fetch.
    void version;
    const result: Record<string, PlayerVisualData | null> = {};
    for (const name of stableNames) {
      result[name] = cache.get(name) ?? null;
    }
    return result;
  }, [stableNames, version]);
}
