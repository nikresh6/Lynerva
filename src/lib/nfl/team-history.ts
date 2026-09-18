import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";

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

const espnCompetitorSchema = z.object({
  homeAway: z.enum(["home", "away"]),
  score: z.string().optional().default(""),
  team: z.object({ abbreviation: z.string() }),
});

const espnScoreboardSchema = z.object({
  events: z
    .array(
      z.object({
        season: z.object({ year: z.number(), type: z.number() }).optional(),
        week: z.object({ number: z.number() }).optional(),
        status: z.object({
          type: z.object({ completed: z.boolean() }),
        }),
        competitions: z.array(
          z.object({
            competitors: z.array(espnCompetitorSchema),
          }),
        ),
      }),
    )
    .default([]),
});

async function fetchEspnWeek(season: number, week: number) {
  try {
    const url = new URL(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    );
    url.searchParams.set("season", String(season));
    url.searchParams.set("week", String(week));
    url.searchParams.set("seasontype", "2");
    url.searchParams.set("limit", "100");
    const response = await fetch(url, {
      headers: { "User-Agent": "Lynerva/1.0 team-history" },
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (!response.ok) return [] as TeamGame[];
    const parsed = espnScoreboardSchema.safeParse(await response.json());
    if (!parsed.success) return [] as TeamGame[];

    const games: TeamGame[] = [];
    for (const event of parsed.data.events) {
      if (
        event.season?.type !== 2 ||
        !event.status.type.completed ||
        !event.competitions[0]
      ) {
        continue;
      }
      const competitors = event.competitions[0].competitors;
      const home = competitors.find((team) => team.homeAway === "home");
      const away = competitors.find((team) => team.homeAway === "away");
      if (!home || !away || !home.score.trim() || !away.score.trim()) continue;

      const homeScore = Number(home.score);
      const awayScore = Number(away.score);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

      const eventSeason = event.season?.year ?? season;
      const eventWeek = event.week?.number ?? week;
      games.push(
        {
          season: eventSeason,
          week: eventWeek,
          team: home.team.abbreviation,
          opponent: away.team.abbreviation,
          isHome: true,
          pointsFor: homeScore,
          pointsAgainst: awayScore,
        },
        {
          season: eventSeason,
          week: eventWeek,
          team: away.team.abbreviation,
          opponent: home.team.abbreviation,
          isHome: false,
          pointsFor: awayScore,
          pointsAgainst: homeScore,
        },
      );
    }
    return games;
  } catch (error) {
    console.warn(
      `ESPN regular-season week unavailable for ${season} W${week}`,
      error,
    );
    return [] as TeamGame[];
  }
}

async function fetchEspnRegularSeasonHistory(
  currentSeason: number,
  currentWeek: number,
) {
  const requests: Array<[number, number]> = [];

  for (let week = 9; week <= 18; week += 1) {
    requests.push([currentSeason - 1, week]);
  }
  for (let week = 1; week < currentWeek; week += 1) {
    requests.push([currentSeason, week]);
  }

  const results = await Promise.all(
    requests.map(([season, week]) => fetchEspnWeek(season, week)),
  );
  return results.flat();
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
  async (
    currentSeason: number,
    currentWeek: number,
  ): Promise<TeamGame[]> =>
    fetchEspnRegularSeasonHistory(currentSeason, currentWeek),
  ["lynerva-regular-season-team-history-v4"],
  { revalidate: 6 * 60 * 60 },
);

export async function getTeamProfile(
  team: string,
  currentSeason: number,
  currentWeek: number,
): Promise<TeamProfile | null> {
  const games = (await loadRegularSeasonTeamGames(currentSeason, currentWeek))
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

export async function getMatchupProjection(
  homeTeam: string,
  awayTeam: string,
  currentSeason: number,
  currentWeek: number,
) {
  const [home, away] = await Promise.all([
    getTeamProfile(homeTeam, currentSeason, currentWeek),
    getTeamProfile(awayTeam, currentSeason, currentWeek),
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
