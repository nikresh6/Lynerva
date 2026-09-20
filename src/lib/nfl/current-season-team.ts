import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { nflGames } from "@/db/schema";
import { clamp } from "@/lib/utils";

export interface CurrentSeasonTeamProfile {
  team: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  recentPointsFor: number;
  recentPointsAgainst: number;
  marginStdDev: number;
  totalStdDev: number;
  recentResults: Array<"W" | "L" | "T">;
}

export interface CurrentSeasonMatchupProjection {
  home: CurrentSeasonTeamProfile;
  away: CurrentSeasonTeamProfile;
  homePoints: number;
  awayPoints: number;
  projectedTotal: number;
  projectedHomeMargin: number;
  marginStdDev: number;
  totalStdDev: number;
  leaguePointsPerTeam: number;
}

interface TeamGame {
  kickoffAt: Date;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
}

const CACHE_MS = 10 * 60_000;
const cache = new Map<
  string,
  { storedAt: number; value: CurrentSeasonMatchupProjection | null }
>();

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: number[], fallback: number) {
  if (values.length < 2) return fallback;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Number.isFinite(variance)
    ? Math.sqrt(Math.max(variance, 0))
    : fallback;
}

function profileFor(
  team: string,
  games: TeamGame[],
  leaguePointsPerTeam: number,
  leagueMarginStdDev: number,
  leagueTotalStdDev: number,
): CurrentSeasonTeamProfile | null {
  if (!games.length) return null;

  const ordered = games.toSorted(
    (a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime(),
  );
  const recent = ordered.slice(-3);
  const margins = ordered.map((game) => game.pointsFor - game.pointsAgainst);
  const totals = ordered.map((game) => game.pointsFor + game.pointsAgainst);

  return {
    team,
    games: ordered.length,
    wins: ordered.filter((game) => game.result === "W").length,
    losses: ordered.filter((game) => game.result === "L").length,
    ties: ordered.filter((game) => game.result === "T").length,
    pointsFor: mean(ordered.map((game) => game.pointsFor)),
    pointsAgainst: mean(ordered.map((game) => game.pointsAgainst)),
    recentPointsFor: mean(recent.map((game) => game.pointsFor)),
    recentPointsAgainst: mean(recent.map((game) => game.pointsAgainst)),
    marginStdDev: sampleStdDev(margins, leagueMarginStdDev),
    totalStdDev: sampleStdDev(totals, leagueTotalStdDev),
    recentResults: recent.map((game) => game.result).reverse(),
  };
}

function shrunkAverage(
  observed: number,
  games: number,
  leagueAverage: number,
) {
  // Week 2 should not treat one 35-point game like a stable team identity.
  // Shrink only toward this season's league environment, never prior seasons.
  const pseudoGames = 3;
  return (
    (observed * games + leagueAverage * pseudoGames) /
    (games + pseudoGames)
  );
}

function formBlend(
  seasonAverage: number,
  recentAverage: number,
  games: number,
) {
  if (games < 2) return seasonAverage;
  const recentWeight = clamp((games - 1) / 8, 0.12, 0.35);
  return seasonAverage * (1 - recentWeight) + recentAverage * recentWeight;
}

export async function getCurrentSeasonMatchupProjection(
  homeTeam: string,
  awayTeam: string,
  season: number,
  currentWeek: number,
): Promise<CurrentSeasonMatchupProjection | null> {
  const key = `${season}:${currentWeek}:${homeTeam}:${awayTeam}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.storedAt < CACHE_MS) {
    return cached.value;
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        kickoffAt: nflGames.kickoffAt,
        week: nflGames.week,
        homeTeam: nflGames.homeTeam,
        awayTeam: nflGames.awayTeam,
        homeScore: nflGames.homeScore,
        awayScore: nflGames.awayScore,
      })
      .from(nflGames)
      .where(
        and(
          eq(nflGames.season, season),
          eq(nflGames.seasonType, "REG"),
          eq(nflGames.status, "final"),
        ),
      );

    const completed = rows.filter(
      (row) =>
        row.homeScore !== null &&
        row.awayScore !== null &&
        (row.week === null || row.week < currentWeek),
    );

    if (!completed.length) {
      cache.set(key, { storedAt: Date.now(), value: null });
      return null;
    }

    const byTeam = new Map<string, TeamGame[]>();
    const margins: number[] = [];
    const totals: number[] = [];
    let teamPoints = 0;
    let teamSamples = 0;

    const push = (team: string, game: TeamGame) => {
      byTeam.set(team, [...(byTeam.get(team) ?? []), game]);
    };

    for (const row of completed) {
      const homeScore = row.homeScore!;
      const awayScore = row.awayScore!;
      const homeResult =
        homeScore > awayScore ? "W" : homeScore < awayScore ? "L" : "T";
      const awayResult =
        awayScore > homeScore ? "W" : awayScore < homeScore ? "L" : "T";

      push(row.homeTeam, {
        kickoffAt: row.kickoffAt,
        pointsFor: homeScore,
        pointsAgainst: awayScore,
        result: homeResult,
      });
      push(row.awayTeam, {
        kickoffAt: row.kickoffAt,
        pointsFor: awayScore,
        pointsAgainst: homeScore,
        result: awayResult,
      });

      margins.push(homeScore - awayScore);
      totals.push(homeScore + awayScore);
      teamPoints += homeScore + awayScore;
      teamSamples += 2;
    }

    const leaguePointsPerTeam =
      teamSamples > 0 ? teamPoints / teamSamples : 22.25;
    const leagueMarginStdDev = sampleStdDev(margins, 13.5);
    const leagueTotalStdDev = sampleStdDev(totals, 13);

    const home = profileFor(
      homeTeam,
      byTeam.get(homeTeam) ?? [],
      leaguePointsPerTeam,
      leagueMarginStdDev,
      leagueTotalStdDev,
    );
    const away = profileFor(
      awayTeam,
      byTeam.get(awayTeam) ?? [],
      leaguePointsPerTeam,
      leagueMarginStdDev,
      leagueTotalStdDev,
    );

    if (!home || !away) {
      cache.set(key, { storedAt: Date.now(), value: null });
      return null;
    }

    const homeFor = formBlend(
      shrunkAverage(home.pointsFor, home.games, leaguePointsPerTeam),
      home.recentPointsFor,
      home.games,
    );
    const homeAgainst = formBlend(
      shrunkAverage(home.pointsAgainst, home.games, leaguePointsPerTeam),
      home.recentPointsAgainst,
      home.games,
    );
    const awayFor = formBlend(
      shrunkAverage(away.pointsFor, away.games, leaguePointsPerTeam),
      away.recentPointsFor,
      away.games,
    );
    const awayAgainst = formBlend(
      shrunkAverage(away.pointsAgainst, away.games, leaguePointsPerTeam),
      away.recentPointsAgainst,
      away.games,
    );

    const homePoints = Math.max(7, (homeFor + awayAgainst) / 2 + 1.4);
    const awayPoints = Math.max(7, (awayFor + homeAgainst) / 2);
    const marginStdDev = clamp(
      (home.marginStdDev + away.marginStdDev + leagueMarginStdDev) / 3,
      10.5,
      18,
    );
    const totalStdDev = clamp(
      (home.totalStdDev + away.totalStdDev + leagueTotalStdDev) / 3,
      9.5,
      20,
    );

    const value = {
      home,
      away,
      homePoints,
      awayPoints,
      projectedTotal: homePoints + awayPoints,
      projectedHomeMargin: homePoints - awayPoints,
      marginStdDev,
      totalStdDev,
      leaguePointsPerTeam,
    };

    cache.set(key, { storedAt: Date.now(), value });
    return value;
  } catch (error) {
    console.error("Current-season team projection unavailable", error);
    cache.set(key, { storedAt: Date.now(), value: null });
    return null;
  }
}
