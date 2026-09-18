import "server-only";

import { unstable_cache } from "next/cache";
import type { CanonicalMarket } from "@/lib/markets/types";
import { OpenMeteoProvider, type WeatherPoint } from "@/lib/weather";

type CsvRow = Record<string, string>;

const TEAM_COORDS: Record<string, { latitude: number; longitude: number }> = {
  ARI: { latitude: 33.5276, longitude: -112.2626 },
  ATL: { latitude: 33.7553, longitude: -84.4006 },
  BAL: { latitude: 39.278, longitude: -76.6227 },
  BUF: { latitude: 42.7738, longitude: -78.7868 },
  CAR: { latitude: 35.2258, longitude: -80.8528 },
  CHI: { latitude: 41.8623, longitude: -87.6167 },
  CIN: { latitude: 39.0954, longitude: -84.516 },
  CLE: { latitude: 41.5061, longitude: -81.6995 },
  DAL: { latitude: 32.7473, longitude: -97.0945 },
  DEN: { latitude: 39.7439, longitude: -105.0201 },
  DET: { latitude: 42.34, longitude: -83.0456 },
  GB: { latitude: 44.5013, longitude: -88.0622 },
  HOU: { latitude: 29.6847, longitude: -95.4107 },
  IND: { latitude: 39.7601, longitude: -86.1639 },
  JAX: { latitude: 30.3239, longitude: -81.6373 },
  KC: { latitude: 39.0489, longitude: -94.4839 },
  LV: { latitude: 36.0909, longitude: -115.1833 },
  LAC: { latitude: 33.9535, longitude: -118.3392 },
  LAR: { latitude: 33.9535, longitude: -118.3392 },
  MIA: { latitude: 25.958, longitude: -80.2389 },
  MIN: { latitude: 44.9736, longitude: -93.2575 },
  NE: { latitude: 42.0909, longitude: -71.2643 },
  NO: { latitude: 29.9511, longitude: -90.0812 },
  NYG: { latitude: 40.8135, longitude: -74.0745 },
  NYJ: { latitude: 40.8135, longitude: -74.0745 },
  PHI: { latitude: 39.9008, longitude: -75.1675 },
  PIT: { latitude: 40.4468, longitude: -80.0158 },
  SF: { latitude: 37.403, longitude: -121.97 },
  SEA: { latitude: 47.5952, longitude: -122.3316 },
  TB: { latitude: 27.9759, longitude: -82.5033 },
  TEN: { latitude: 36.1665, longitude: -86.7713 },
  WAS: { latitude: 38.9078, longitude: -76.8645 },
};

export interface GameWeatherContext {
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  roof: string | null;
  indoor: boolean;
  weather: WeatherPoint | null;
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

const loadSchedule = unstable_cache(
  async () => {
    const response = await fetch(
      "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
      {
        headers: { "User-Agent": "Lynerva/1.0 game-context" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`nflverse schedule returned ${response.status}`);
    }
    return parseCsv(await response.text());
  },
  ["lynerva-nfl-schedule-context-v1"],
  { revalidate: 60 * 60 },
);

function kickoff(row: CsvRow) {
  if (!row.gameday) return null;
  const time = row.gametime || "13:00";
  // nflverse gametime is published in US Eastern time. The active NFL season
  // is predominantly in daylight time; a one-hour forecast offset has minimal
  // effect and weather is only used as a conservative context adjustment.
  const value = new Date(`${row.gameday}T${time}:00-04:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function matchupKey(homeTeam: string, awayTeam: string) {
  return [homeTeam, awayTeam].toSorted().join("-");
}

function dateDistanceDays(first: string, second: string) {
  const a = new Date(`${first}T12:00:00Z`).getTime();
  const b = new Date(`${second}T12:00:00Z`).getTime();
  return Math.abs(a - b) / 86_400_000;
}

const getForecast = unstable_cache(
  async (homeTeam: string, kickoffAt: string) => {
    const coords = TEAM_COORDS[homeTeam];
    if (!coords) return null;
    const provider = new OpenMeteoProvider();
    return provider.getForecast({
      ...coords,
      kickoffAt: new Date(kickoffAt),
    });
  },
  ["lynerva-open-meteo-game-forecast-v1"],
  { revalidate: 15 * 60 },
);

export async function getGameWeatherContext(
  canonical: CanonicalMarket,
): Promise<GameWeatherContext | null> {
  if (!canonical.matchup || !canonical.settlementDate) return null;

  try {
    const rows = await loadSchedule();
    const candidates = rows
      .filter(
        (row) =>
          row.home_team &&
          row.away_team &&
          matchupKey(row.home_team, row.away_team) === canonical.matchup,
      )
      .map((row) => ({
        row,
        distance: row.gameday
          ? dateDistanceDays(row.gameday, canonical.settlementDate!)
          : Infinity,
      }))
      .filter((item) => item.distance <= 2)
      .toSorted((a, b) => a.distance - b.distance);

    const row = candidates[0]?.row;
    if (!row?.home_team || !row.away_team) return null;
    const kickoffAt = kickoff(row);
    if (!kickoffAt) return null;

    const roof = row.roof || null;
    const indoor = /dome|closed/i.test(roof ?? "");
    const weather = indoor
      ? null
      : await getForecast(row.home_team, kickoffAt.toISOString());

    return {
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      kickoffAt: kickoffAt.toISOString(),
      roof,
      indoor,
      weather,
    };
  } catch (error) {
    console.error("NFL game weather context failed", error);
    return null;
  }
}
