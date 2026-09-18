import "server-only";

import {
  TEAM_REGULAR_SEASON_PROFILES,
  type StaticTeamProfile,
} from "@/data/team-regular-season-profiles";

export interface TeamProfile extends StaticTeamProfile {
  team: string;
}

export function getTeamProfile(team: string): TeamProfile | null {
  const profile = TEAM_REGULAR_SEASON_PROFILES[team];
  if (!profile) return null;
  return {
    team,
    ...profile,
  };
}

export function getMatchupProjection(
  homeTeam: string,
  awayTeam: string,
  _currentSeason?: number,
  _currentWeek?: number,
) {
  const home = getTeamProfile(homeTeam);
  const away = getTeamProfile(awayTeam);
  if (!home || !away) return null;

  const weighted = (full: number, recent: number) =>
    full * 0.65 + recent * 0.35;
  const homeOffense = weighted(home.pointsFor, home.recentPointsFor);
  const homeDefense = weighted(home.pointsAgainst, home.recentPointsAgainst);
  const awayOffense = weighted(away.pointsFor, away.recentPointsFor);
  const awayDefense = weighted(away.pointsAgainst, away.recentPointsAgainst);

  const homePoints = Math.max(6, (homeOffense + awayDefense) / 2 + 1.4);
  const awayPoints = Math.max(6, (awayOffense + homeDefense) / 2);
  const marginStdDev = Math.min(
    18,
    Math.max(10.5, (home.marginStdDev + away.marginStdDev) / 2),
  );
  const totalStdDev = Math.min(
    20,
    Math.max(9.5, (home.totalStdDev + away.totalStdDev) / 2),
  );

  return {
    home,
    away,
    homePoints,
    awayPoints,
    projectedTotal: homePoints + awayPoints,
    projectedHomeMargin: homePoints - awayPoints,
    marginStdDev,
    totalStdDev,
  };
}
