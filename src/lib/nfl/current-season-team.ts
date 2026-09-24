import "server-only";

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

interface CompletedGame {
  kickoffAt: Date;
  week: number | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

type CsvRow = Record<string, string>;

const CACHE_MS = 20 * 60_000;
const FAILURE_BACKOFF_MS = 10 * 60_000;
let seasonGamesRetryAfter = 0;
let seasonGamesFailureLoggedAt = 0;
const matchupCache = new Map<
  string,
  { storedAt: number; value: CurrentSeasonMatchupProjection | null }
>();
const seasonGamesCache = new Map<
  string,
  { expiresAt: number; promise: Promise<CompletedGame[]> }
>();

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

function numberOrNull(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gameDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function loadCompletedSeasonGames(season: number, currentWeek: number) {
  const key = `${season}:${currentWeek}`;
  const cached = seasonGamesCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (Date.now() < seasonGamesRetryAfter) {
    return Promise.resolve([] as CompletedGame[]);
  }

  const entry = {
    expiresAt: Date.now() + CACHE_MS,
    promise: (async () => {
      const response = await fetch(
        "https://cdn.jsdelivr.net/gh/nflverse/nfldata@master/data/games.csv",
        {
          cache: "no-store",
          headers: { "user-agent": "Lynerva/1.0 current-season-team-model" },
          signal: AbortSignal.timeout(2_500),
        },
      );
      if (!response.ok) {
        throw new Error(`nflverse games returned ${response.status}`);
      }

      const games = parseCsv(await response.text()).flatMap((row) => {
        if (
          Number(row.season) !== season ||
          row.game_type !== "REG" ||
          !row.home_team ||
          !row.away_team
        ) {
          return [];
        }

        const week = numberOrNull(row.week);
        // For a Week N prediction, only Weeks < N are eligible. This keeps
        // Sunday afternoon games from learning from earlier Week N finals.
        if (week !== null && week >= currentWeek) return [];

        const kickoffAt = gameDate(row.gameday);
        const homeScore = numberOrNull(row.home_score);
        const awayScore = numberOrNull(row.away_score);
        if (
          !kickoffAt ||
          homeScore === null ||
          awayScore === null
        ) {
          return [];
        }

        return [{
          kickoffAt,
          week,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          homeScore,
          awayScore,
        }];
      });
      seasonGamesRetryAfter = 0;
      return games;
    })().catch((error) => {
      seasonGamesRetryAfter = Date.now() + FAILURE_BACKOFF_MS;
      if (Date.now() - seasonGamesFailureLoggedAt > FAILURE_BACKOFF_MS) {
        seasonGamesFailureLoggedAt = Date.now();
        console.warn(
          "Current-season team feed unavailable; using baseline game model until retry window.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return [] as CompletedGame[];
    }),
  };

  seasonGamesCache.set(key, entry);
  return entry.promise;
}

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
  // Early-season samples are noisy. The prior is the current season's league
  // scoring environment, never a previous NFL season.
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
  const cached = matchupCache.get(key);
  if (cached && Date.now() - cached.storedAt < CACHE_MS) {
    return cached.value;
  }

  try {
    const completed = await loadCompletedSeasonGames(season, currentWeek);
    if (!completed.length) {
      matchupCache.set(key, { storedAt: Date.now(), value: null });
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
      const homeResult =
        row.homeScore > row.awayScore
          ? "W"
          : row.homeScore < row.awayScore
            ? "L"
            : "T";
      const awayResult =
        row.awayScore > row.homeScore
          ? "W"
          : row.awayScore < row.homeScore
            ? "L"
            : "T";

      push(row.homeTeam, {
        kickoffAt: row.kickoffAt,
        pointsFor: row.homeScore,
        pointsAgainst: row.awayScore,
        result: homeResult,
      });
      push(row.awayTeam, {
        kickoffAt: row.kickoffAt,
        pointsFor: row.awayScore,
        pointsAgainst: row.homeScore,
        result: awayResult,
      });

      margins.push(row.homeScore - row.awayScore);
      totals.push(row.homeScore + row.awayScore);
      teamPoints += row.homeScore + row.awayScore;
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
      matchupCache.set(key, { storedAt: Date.now(), value: null });
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

    matchupCache.set(key, { storedAt: Date.now(), value });
    return value;
  } catch {
    matchupCache.set(key, { storedAt: Date.now(), value: null });
    return null;
  }
}
