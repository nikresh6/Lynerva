import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  nflGames,
  nflPlayers,
  playerGameStats,
} from "@/db/schema";
import {
  PLAYER_REGULAR_SEASON_HISTORY,
  type StaticPlayerHistory,
} from "@/data/player-regular-season-history";

export interface HistoricalValue {
  season: number;
  week: number;
  value: number;
}

export interface RecentPlayerActual {
  playerName: string;
  passingYards: number | null;
  passingTouchdowns: number | null;
  passingInterceptions: number | null;
  rushingYards: number | null;
  rushingTouchdowns: number | null;
  receivingYards: number | null;
  receptions: number | null;
  receivingTouchdowns: number | null;
}

interface RecentPlayerHistory {
  playerName: string;
  values: Map<string, HistoricalValue>;
}

const playerMatchCache = new Map<string, StaticPlayerHistory | null>();
const recentEspnHistory = new Map<string, RecentPlayerHistory>();

type PersistedPlayerActual = RecentPlayerActual & {
  week: number | null;
};

const PERSISTED_HISTORY_CACHE_MS = 2 * 60_000;
const persistedSeasonHistoryCache = new Map<
  number,
  {
    expiresAt: number;
    promise: Promise<PersistedPlayerActual[]>;
  }
>();

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function valueFromTuple(game: number[], statistic: string) {
  switch (statistic) {
    case "passing_yards":
      return game[2] ?? 0;
    case "passing_touchdowns":
      return game[3] ?? 0;
    case "rushing_yards":
      return game[4] ?? 0;
    case "receiving_yards":
      return game[5] ?? 0;
    case "receptions":
      return game[6] ?? 0;
    case "touchdowns":
      return game[7] ?? 0;
    // The compact static history stores total touchdowns, not separate rushing
    // and receiving touchdown counts. Split TD markets stay projection-backed
    // until a split historical series is available rather than borrowing the
    // wrong total-touchdown history.
    case "passing_interceptions":
    case "rushing_touchdowns":
    case "receiving_touchdowns":
      return null;
    default:
      return null;
  }
}

function valueFromRecentActual(
  row: RecentPlayerActual,
  statistic: string,
) {
  switch (statistic) {
    case "passing_yards":
      return row.passingYards;
    case "passing_touchdowns":
      return row.passingTouchdowns;
    case "passing_interceptions":
      return row.passingInterceptions;
    case "rushing_yards":
      return row.rushingYards;
    case "rushing_touchdowns":
      return row.rushingTouchdowns;
    case "receiving_yards":
      return row.receivingYards;
    case "receptions":
      return row.receptions;
    case "receiving_touchdowns":
      return row.receivingTouchdowns;
    case "touchdowns":
      if (
        row.rushingTouchdowns === null &&
        row.receivingTouchdowns === null
      ) {
        return null;
      }
      return (row.rushingTouchdowns ?? 0) + (row.receivingTouchdowns ?? 0);
    default:
      return null;
  }
}

function findStaticPlayer(subject: string) {
  const normalizedSubject = normalizePerson(subject);
  let player = playerMatchCache.get(normalizedSubject);
  if (player !== undefined) return player;

  player = PLAYER_REGULAR_SEASON_HISTORY[normalizedSubject] ?? null;

  if (!player && normalizedSubject.length >= 5) {
    let bestKey = "";
    for (const [normalized, candidate] of Object.entries(
      PLAYER_REGULAR_SEASON_HISTORY,
    )) {
      if (
        normalized.length >= 5 &&
        (normalizedSubject.includes(normalized) ||
          normalized.includes(normalizedSubject)) &&
        normalized.length > bestKey.length
      ) {
        bestKey = normalized;
        player = candidate;
      }
    }
  }

  playerMatchCache.set(normalizedSubject, player);
  return player;
}

function findRecentPlayer(subject: string) {
  const normalizedSubject = normalizePerson(subject);
  const exact = recentEspnHistory.get(normalizedSubject);
  if (exact) return exact;
  if (normalizedSubject.length < 5) return null;

  let bestKey = "";
  let best: RecentPlayerHistory | null = null;
  for (const [normalized, candidate] of recentEspnHistory) {
    if (
      normalized.length >= 5 &&
      (normalizedSubject.includes(normalized) ||
        normalized.includes(normalizedSubject)) &&
      normalized.length > bestKey.length
    ) {
      bestKey = normalized;
      best = candidate;
    }
  }
  return best;
}

function loadPersistedSeasonHistory(season: number) {
  const cached = persistedSeasonHistoryCache.get(season);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    expiresAt: Date.now() + PERSISTED_HISTORY_CACHE_MS,
    promise: (async (): Promise<PersistedPlayerActual[]> => {
      const db = getDb();
      return db
        .select({
          playerName: nflPlayers.fullName,
          week: nflGames.week,
          passingYards: playerGameStats.passingYards,
          passingTouchdowns: playerGameStats.passingTouchdowns,
          passingInterceptions: playerGameStats.passingInterceptions,
          rushingYards: playerGameStats.rushingYards,
          rushingTouchdowns: playerGameStats.rushingTouchdowns,
          receivingYards: playerGameStats.receivingYards,
          receptions: playerGameStats.receptions,
          receivingTouchdowns: playerGameStats.receivingTouchdowns,
        })
        .from(playerGameStats)
        .innerJoin(nflPlayers, eq(nflPlayers.id, playerGameStats.playerId))
        .innerJoin(nflGames, eq(nflGames.id, playerGameStats.gameId))
        .where(
          and(
            eq(nflGames.season, season),
            eq(nflGames.seasonType, "REG"),
            eq(nflGames.status, "final"),
          ),
        );
    })(),
  };

  persistedSeasonHistoryCache.set(season, entry);
  entry.promise.catch(() => {
    if (persistedSeasonHistoryCache.get(season) === entry) {
      persistedSeasonHistoryCache.delete(season);
    }
  });
  return entry.promise;
}

export function invalidatePersistedPlayerHistoryCache() {
  persistedSeasonHistoryCache.clear();
}

async function findPersistedPlayerValues(
  subject: string,
  statistic: string,
  season: number,
) {
  try {
    const rows = await loadPersistedSeasonHistory(season);
    const normalizedSubject = normalizePerson(subject);
    let matchedKey = rows
      .map((row) => normalizePerson(row.playerName))
      .find((key) => key === normalizedSubject) ?? null;

    if (!matchedKey && normalizedSubject.length >= 5) {
      matchedKey =
        [...new Set(rows.map((row) => normalizePerson(row.playerName)))]
          .filter(
            (key) =>
              key.length >= 5 &&
              (normalizedSubject.includes(key) ||
                key.includes(normalizedSubject)),
          )
          .toSorted((first, second) => second.length - first.length)[0] ?? null;
    }

    if (!matchedKey) {
      return {
        playerName: null as string | null,
        values: [] as HistoricalValue[],
      };
    }

    const matchedRows = rows.filter(
      (row) => normalizePerson(row.playerName) === matchedKey,
    );
    const values = matchedRows.flatMap((row): HistoricalValue[] => {
      if (row.week === null) return [];
      const value = valueFromRecentActual(row, statistic);
      if (value === null || !Number.isFinite(value)) return [];
      return [{
        season,
        week: row.week,
        value,
      }];
    });

    return {
      playerName: matchedRows[0]?.playerName ?? null,
      values,
    };
  } catch {
    return {
      playerName: null as string | null,
      values: [] as HistoricalValue[],
    };
  }
}

export function recordEspnFinalPlayerStats(
  season: number,
  week: number,
  rows: RecentPlayerActual[],
) {
  if (!Number.isFinite(season) || !Number.isFinite(week)) return;

  const statistics = [
    "passing_yards",
    "passing_touchdowns",
    "passing_interceptions",
    "rushing_yards",
    "rushing_touchdowns",
    "receiving_yards",
    "receptions",
    "receiving_touchdowns",
    "touchdowns",
  ] as const;

  for (const row of rows) {
    const playerKey = normalizePerson(row.playerName);
    if (!playerKey) continue;

    const entry = recentEspnHistory.get(playerKey) ?? {
      playerName: row.playerName,
      values: new Map<string, HistoricalValue>(),
    };
    entry.playerName = row.playerName;

    for (const statistic of statistics) {
      const value = valueFromRecentActual(row, statistic);
      if (value === null || !Number.isFinite(value)) continue;
      entry.values.set(`${season}:${week}:${statistic}`, {
        season,
        week,
        value,
      });
    }

    recentEspnHistory.set(playerKey, entry);
  }
}

export async function findPublicPlayerSeasonHistory(
  subject: string,
  statistic: string,
  season: number,
) {
  const player = findStaticPlayer(subject);
  const recent = findRecentPlayer(subject);
  const persisted = await findPersistedPlayerValues(
    subject,
    statistic,
    season,
  );

  const staticValues = (player?.g ?? [])
    .filter((game) => (game[0] ?? 0) === season)
    .map((game): HistoricalValue | null => {
      const value = valueFromTuple(game, statistic);
      if (value === null) return null;
      return {
        season: game[0] ?? 0,
        week: game[1] ?? 0,
        value,
      };
    })
    .filter((row): row is HistoricalValue => row !== null);

  const recentValues = recent
    ? [...recent.values.values()].filter(
        (row) =>
          row.season === season &&
          recent.values.get(`${season}:${row.week}:${statistic}`) === row,
      )
    : [];

  // ESPN final box scores are refreshed every 30 minutes by the long-running
  // Railway scheduler. Let those rows override the generated static snapshot
  // for the same week so player-specific volatility learns immediately after
  // each completed game, while nflverse remains the durable historical base.
  const byWeek = new Map<number, HistoricalValue>();
  for (const row of recentValues) byWeek.set(row.week, row);
  for (const row of persisted.values) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, row);
  }
  for (const row of staticValues) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, row);
  }

  const values = [...byWeek.values()]
    .toSorted((first, second) => second.week - first.week)
    .slice(0, 24);

  return {
    playerName:
      recent?.playerName ??
      persisted.playerName ??
      player?.n ??
      null,
    values,
  };
}

export async function findPublicPlayerHistory(
  subject: string,
  statistic: string,
) {
  return findPublicPlayerSeasonHistory(
    subject,
    statistic,
    new Date().getUTCFullYear(),
  );
}
