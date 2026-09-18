import "server-only";

import { z } from "zod";
import { fetchValidated } from "@/lib/providers/http";

const geocodeSchema = z.object({
  results: z.array(z.object({
    latitude: z.number(),
    longitude: z.number(),
  })).optional(),
});

const forecastSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    precipitation_probability: z.array(z.number()),
    wind_speed_10m: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
});

export interface WeatherPoint {
  forecastFor: string;
  temperatureF: number;
  windMph: number;
  precipitationProbability: number;
  weatherCode: number;
  severe: boolean;
}

export interface WeatherProvider {
  getForecast(input: {
    latitude: number;
    longitude: number;
    kickoffAt: Date;
  }): Promise<WeatherPoint | null>;
}

export class OpenMeteoProvider implements WeatherProvider {
  async getForecast(input: {
    latitude: number;
    longitude: number;
    kickoffAt: Date;
  }) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(input.latitude));
    url.searchParams.set("longitude", String(input.longitude));
    url.searchParams.set(
      "hourly",
      "temperature_2m,precipitation_probability,wind_speed_10m,weather_code",
    );
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("timezone", "UTC");
    const payload = await fetchValidated(
      "Open-Meteo",
      url.toString(),
      forecastSchema,
    );
    const target = input.kickoffAt.getTime();
    let closest = -1;
    let distance = Infinity;
    for (let index = 0; index < payload.hourly.time.length; index += 1) {
      const currentDistance = Math.abs(
        new Date(`${payload.hourly.time[index]}Z`).getTime() - target,
      );
      if (currentDistance < distance) {
        closest = index;
        distance = currentDistance;
      }
    }
    if (closest < 0) return null;
    const windMph = payload.hourly.wind_speed_10m[closest] ?? 0;
    const precipitationProbability =
      payload.hourly.precipitation_probability[closest] ?? 0;
    const weatherCode = payload.hourly.weather_code[closest] ?? 0;
    return {
      forecastFor: new Date(`${payload.hourly.time[closest]}Z`).toISOString(),
      temperatureF: payload.hourly.temperature_2m[closest] ?? 0,
      windMph,
      precipitationProbability,
      weatherCode,
      severe:
        windMph >= 25 ||
        precipitationProbability >= 80 ||
        [95, 96, 99].includes(weatherCode),
    };
  }
}


const gameWeatherCache = new Map<string, { at: number; weather: WeatherPoint | null }>();

export async function getGameWeather(input: {
  stadium: string | null | undefined;
  kickoffAt: string | Date;
}) {
  if (!input.stadium) return null;
  const kickoff = input.kickoffAt instanceof Date ? input.kickoffAt : new Date(input.kickoffAt);
  if (Number.isNaN(kickoff.getTime())) return null;
  const key = `${input.stadium}:${kickoff.toISOString().slice(0, 13)}`;
  const cached = gameWeatherCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.weather;

  try {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", input.stadium);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("format", "json");
    const place = await fetchValidated(
      "Open-Meteo geocoding",
      geocodeUrl.toString(),
      geocodeSchema,
    );
    const result = place.results?.[0];
    if (!result) {
      gameWeatherCache.set(key, { at: Date.now(), weather: null });
      return null;
    }
    const weather = await new OpenMeteoProvider().getForecast({
      latitude: result.latitude,
      longitude: result.longitude,
      kickoffAt: kickoff,
    });
    gameWeatherCache.set(key, { at: Date.now(), weather });
    return weather;
  } catch (error) {
    console.error("Game weather unavailable", error);
    gameWeatherCache.set(key, { at: Date.now(), weather: null });
    return null;
  }
}
