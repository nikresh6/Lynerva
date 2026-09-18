import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";
import type { NflScheduleGame } from "@/lib/nfl/schedule-match";
import { OpenMeteoProvider, type WeatherPoint } from "@/lib/weather";

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

const WEATHER_NEUTRAL_HOME_TEAMS = new Set([
  "ARI",
  "ATL",
  "DAL",
  "DET",
  "HOU",
  "IND",
  "LV",
  "LAC",
  "LAR",
  "MIN",
  "NO",
]);

export interface GameWeatherContext {
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  roof: string | null;
  indoor: boolean;
  weather: WeatherPoint | null;
}

const forecastPromises = new Map<string, Promise<WeatherPoint | null>>();

function getForecast(homeTeam: string, kickoffAt: string) {
  const coords = TEAM_COORDS[homeTeam];
  if (!coords) return Promise.resolve(null);

  const key = `${homeTeam}:${kickoffAt.slice(0, 13)}`;
  const existing = forecastPromises.get(key);
  if (existing) return existing;

  const task = new OpenMeteoProvider()
    .getForecast({
      ...coords,
      kickoffAt: new Date(kickoffAt),
    })
    .catch((error) => {
      console.error("Weather forecast unavailable", error);
      return null;
    });

  forecastPromises.set(key, task);
  return task;
}

export async function getWeatherForGame(
  homeTeam: string,
  awayTeam: string,
  kickoffAt: string,
): Promise<GameWeatherContext | null> {
  const indoor = WEATHER_NEUTRAL_HOME_TEAMS.has(homeTeam);
  const weather = indoor ? null : await getForecast(homeTeam, kickoffAt);
  return {
    homeTeam,
    awayTeam,
    kickoffAt,
    roof: indoor ? "indoor/retractable" : null,
    indoor,
    weather,
  };
}

export async function getGameWeatherContext(
  canonical: CanonicalMarket,
  scheduleGame?: NflScheduleGame | null,
): Promise<GameWeatherContext | null> {
  if (!canonical.matchup || !scheduleGame) return null;

  const indoor = WEATHER_NEUTRAL_HOME_TEAMS.has(scheduleGame.homeTeam);
  const weather = indoor
    ? null
    : await getForecast(scheduleGame.homeTeam, scheduleGame.kickoffAt);

  return {
    homeTeam: scheduleGame.homeTeam,
    awayTeam: scheduleGame.awayTeam,
    kickoffAt: scheduleGame.kickoffAt,
    roof: indoor ? "indoor/retractable" : null,
    indoor,
    weather,
  };
}
