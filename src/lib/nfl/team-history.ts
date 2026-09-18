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
      headers: { "User-Agent": "Lynerva/1.0 team-history-fallback" },
      signal: AbortSignal.timeout(5_000),
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
  } catch {
    return [] as TeamGame[];
  }
}

async function fetchEspnRegularSeasonHistory() {
  const now = new Date();
  const currentSeason = now.getUTCFullYear();

  let currentWeek = 2;
  try {
    const response = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
      {
        headers: { "User-Agent": "Lynerva/1.0 team-history-fallback" },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
    if (response.ok) {
      const parsed = espnScoreboardSchema.safeParse(await response.json());
      const week = parsed.success
        ? parsed.data.events.find((event) => event.week?.number)?.week?.number
        : null;
      if (week) currentWeek = week;
    }
  } catch {
    // The explicit week requests below still provide the prior season baseline.
  }

  const requests: Array<[number, number]> = [];
  for (let week = 1; week <= 18; week += 1) {
    requests.push([currentSeason - 1, week]);
  }
  for (let week = 1; week < currentWeek; week += 1) {
    requests.push([currentSeason, week]);
  }

  const games: TeamGame[] = [];
  const batchSize = 6;
  for (let index = 0; index < requests.length; index += batchSize) {
    const batch = requests.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map(([season, week]) => fetchEspnWeek(season, week)),
    );
    games.push(...results.flat());
  }
  return games;
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
    try {
      const response = await fetch(
        "https://cdn.jsdelivr.net/gh/nflverse/nfldata@master/data/games.csv",
        {
          headers: { "User-Agent": "Lynerva/1.0 team-history" },
          signal: AbortSignal.timeout(3_500),
        },
      );
      if (!response.ok) throw new Error(`nflverse games returned ${response.status}`);

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
        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

        const week = Number(row.week || 0);
        games.push(
          {
            season,
            week,
            team: row.home_team,
            opponent: row.away_team,
            isHome: true,
            pointsFor: homeScore,
            pointsAgainst: awayScore,
          },
          {
            season,
            week,
            team: row.away_team,
            opponent: row.home_team,
            isHome: false,
            pointsFor: awayScore,
            pointsAgainst: homeScore,
          },
        );
      }
      if (games.length >= 500) return games;
    } catch (error) {
      console.warn("nflverse team history unavailable, using ESPN fallback", error);
    }

    return fetchEspnRegularSeasonHistory();
  },
  ["lynerva-regular-season-team-history-v2"],
  { revalidate: 6 * 60 * 60 },
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
