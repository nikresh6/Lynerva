import type { CanonicalMarket } from "@/lib/markets/types";

export interface NflScheduleGame {
  gameId: string;
  season: number;
  week: number | null;
  seasonType: string;
  gameday: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  stadium: string | null;
  roof: string | null;
}

const ELIGIBLE_SEASON_TYPES = new Set(["REG", "WC", "DIV", "CON", "SB", "POST"]);

function matchupKey(homeTeam: string, awayTeam: string) {
  return [homeTeam, awayTeam].toSorted().join("-");
}

function dateDistanceDays(first: string, second: string) {
  const a = new Date(`${first}T12:00:00Z`).getTime();
  const b = new Date(`${second}T12:00:00Z`).getTime();
  return Math.abs(a - b) / 86_400_000;
}

export function isEligibleNflSeasonType(value: string) {
  return ELIGIBLE_SEASON_TYPES.has(value.toUpperCase());
}

export function findEligibleScheduleGame(
  canonical: CanonicalMarket | null,
  games: NflScheduleGame[],
  now = Date.now(),
) {
  if (!canonical?.matchup || !canonical.settlementDate) return null;

  const candidates = games
    .filter(
      (game) =>
        isEligibleNflSeasonType(game.seasonType) &&
        matchupKey(game.homeTeam, game.awayTeam) === canonical.matchup &&
        dateDistanceDays(game.gameday, canonical.settlementDate!) <= 2,
    )
    .filter(
      (game) =>
        new Date(game.kickoffAt).getTime() >= now - 8 * 60 * 60 * 1_000,
    )
    .toSorted((first, second) => {
      const firstDate = dateDistanceDays(
        first.gameday,
        canonical.settlementDate!,
      );
      const secondDate = dateDistanceDays(
        second.gameday,
        canonical.settlementDate!,
      );
      if (firstDate !== secondDate) return firstDate - secondDate;
      return (
        Math.abs(new Date(first.kickoffAt).getTime() - now) -
        Math.abs(new Date(second.kickoffAt).getTime() - now)
      );
    });

  return candidates[0] ?? null;
}
