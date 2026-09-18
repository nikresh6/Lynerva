import "server-only";

import { PLAYER_REGULAR_SEASON_HISTORY } from "@/data/player-regular-season-history";

export interface HistoricalValue {
  season: number;
  week: number;
  value: number;
}

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
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
    default:
      return null;
  }
}

export async function findPublicPlayerHistory(
  subject: string,
  statistic: string,
) {
  const normalizedSubject = normalizePerson(subject);
  const match = Object.entries(PLAYER_REGULAR_SEASON_HISTORY)
    .filter(
      ([normalized]) =>
        normalized.length >= 5 &&
        (normalizedSubject === normalized ||
          normalizedSubject.includes(normalized) ||
          normalized.includes(normalizedSubject)),
    )
    .toSorted(([first], [second]) => second.length - first.length)[0];

  if (!match) {
    return { playerName: null, values: [] as HistoricalValue[] };
  }

  const [, player] = match;
  const values = player.g
    .map((game): HistoricalValue | null => {
      const value = valueFromTuple(game, statistic);
      if (value === null) return null;
      return {
        season: game[0] ?? 0,
        week: game[1] ?? 0,
        value,
      };
    })
    .filter((row): row is HistoricalValue => row !== null)
    .slice(0, 24);

  return { playerName: player.n, values };
}
