import "server-only";

import { z } from "zod";
import { clamp } from "@/lib/utils";

const numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
});

const summarySchema = z
  .object({
    predictor: z
      .object({
        homeTeam: z
          .object({ gameProjection: numeric.optional() })
          .passthrough()
          .optional(),
        awayTeam: z
          .object({ gameProjection: numeric.optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    winprobability: z
      .array(
        z
          .object({
            homeWinPercentage: numeric.optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export interface EspnGameProbability {
  pregameHomeProbability: number | null;
  liveHomeProbability: number | null;
  fetchedAt: string;
}

const CACHE_MS = 10 * 60_000;
const FAILURE_CACHE_MS = 45_000;
const cache = new Map<
  string,
  { expiresAt: number; promise: Promise<EspnGameProbability | null> }
>();

function asProbability(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return clamp(normalized, 0.001, 0.999);
}

export function getEspnGameProbability(eventId: string) {
  const cached = cache.get(eventId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    expiresAt: Date.now() + CACHE_MS,
    promise: (async () => {
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`,
          {
            cache: "no-store",
            headers: { "user-agent": "Mozilla/5.0 Lynerva/1.0" },
            signal: AbortSignal.timeout(2_500),
          },
        );
        if (!response.ok) {
          throw new Error(`ESPN summary returned ${response.status}`);
        }

        const parsed = summarySchema.safeParse(await response.json());
        if (!parsed.success) return null;

        const pregameHomeProbability = asProbability(
          parsed.data.predictor?.homeTeam?.gameProjection,
        );
        const livePoints = parsed.data.winprobability ?? [];
        const latestLive = [...livePoints]
          .reverse()
          .find((point) => point.homeWinPercentage !== undefined);
        const liveHomeProbability = asProbability(
          latestLive?.homeWinPercentage,
        );

        if (
          pregameHomeProbability === null &&
          liveHomeProbability === null
        ) {
          return null;
        }

        return {
          pregameHomeProbability,
          liveHomeProbability,
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error("ESPN game probability unavailable", error);
        return null;
      }
    })(),
  };

  cache.set(eventId, entry);
  entry.promise.then((value) => {
    if (value === null) {
      const current = cache.get(eventId);
      if (current === entry) current.expiresAt = Date.now() + FAILURE_CACHE_MS;
    }
  });
  return entry.promise;
}
