import "server-only";

import { unstable_cache } from "next/cache";

type CsvRow = Record<string, string>;

export interface TeamGame {
  season: number;
  week: number;
  team: string;
  opponent: string;
  isHome: boolean;
  pointsFor: number;
  pointsAgainst: number;
}

export interface TeamProfile {
  team: string;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  recentPointsFor: number;
  recentPointsAgainst: number;
  marginStdDev: number;
  totalStdDev: number;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(text: string) {
  const lines = text.replaceAll("\r\n", "\n").split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line): CsvRow => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function stdDev(values: number[]) {
  if (values.length < 2) return 13;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

const loadRegularSeasonTeamGames = unstable_cache(
  async (): Promise<TeamGame[]> => {
    const response = await fetch(
      "https://cdn.jsdelivr.net/gh/nflverse/nfldata@master/data/games.csv",
      {
        headers: { "User-Agent": "Lynerva/1.0 team-history" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`nflverse games returned ${response.status}`);
    }

    const currentSeason = new Date().getUTCFullYear();
    const rows = parseCsv(await response.text());
    const games: TeamGame[] = [];

    for (const row of rows) {
      const season = Number(row.season);
      if (
        !Number.isFinite(season) ||
        season < currentSeason - 2 ||
        season > currentSeason ||
        row.game_type !== "REG"
      ) {
        continue;
      }
      if (
        !row.home_team ||
        !row.away_team ||
        !row.home_score?.trim() ||
        !row.away_score?.trim()
      ) {
        continue;
      }
      const homeScore = Number(row.home_score);
      const awayScore = Number(row.away_score);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
        continue;
      }

      const week = Number(row.week || 0);
      games.push({
        season,
        week,
        team: row.home_team,
        opponent: row.away_team,
        isHome: true,
        pointsFor: homeScore,
        pointsAgainst: awayScore,
      });
      games.push({
        season,
        week,
        team: row.away_team,
        opponent: row.home_team,
        isHome: false,
        pointsFor: awayScore,
        pointsAgainst: homeScore,
      });
    }

    return games;
  },
  ["lynerva-regular-season-team-history-v1"],
  { revalidate: 60 * 60 },
);

export async function getTeamProfile(team: string): Promise<TeamProfile | null> {
  const games = (await loadRegularSeasonTeamGames())
    .filter((game) => game.team === team)
    .toSorted((a, b) => b.season - a.season || b.week - a.week)
    .slice(0, 24);

  if (games.length < 6) return null;

  const recent = games.slice(0, 6);
  const margins = games.map((game) => game.pointsFor - game.pointsAgainst);
  const totals = games.map((game) => game.pointsFor + game.pointsAgainst);

  return {
    team,
    games: games.length,
    pointsFor: mean(games.map((game) => game.pointsFor)),
    pointsAgainst: mean(games.map((game) => game.pointsAgainst)),
    recentPointsFor: mean(recent.map((game) => game.pointsFor)),
    recentPointsAgainst: mean(recent.map((game) => game.pointsAgainst)),
    marginStdDev: stdDev(margins),
    totalStdDev: stdDev(totals),
  };
}

export async function getMatchupProjection(homeTeam: string, awayTeam: string) {
  const [home, away] = await Promise.all([
    getTeamProfile(homeTeam),
    getTeamProfile(awayTeam),
  ]);
  if (!home || !away) return null;

  const weighted = (full: number, recent: number) => full * 0.65 + recent * 0.35;
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
