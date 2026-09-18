import { describe, expect, it } from "vitest";
import { weatherProbabilityAdjustment } from "./index";
import type { WeatherPoint } from "@/lib/weather";

const badWeather: WeatherPoint = {
  forecastFor: "2026-09-20T17:00:00.000Z",
  temperatureF: 28,
  windMph: 24,
  precipitationProbability: 70,
  weatherCode: 61,
  severe: false,
};

describe("weather model context", () => {
  it("reduces an outdoor passing over in adverse weather", () => {
    expect(
      weatherProbabilityAdjustment({
        family: "passing_yards",
        direction: "over",
        indoor: false,
        weather: badWeather,
      }),
    ).toBeLessThan(0);
  });

  it("increases an under probability in the same adverse weather", () => {
    expect(
      weatherProbabilityAdjustment({
        family: "receiving_yards",
        direction: "under",
        indoor: false,
        weather: badWeather,
      }),
    ).toBeGreaterThan(0);
  });

  it("does not force a weather adjustment for rushing props", () => {
    expect(
      weatherProbabilityAdjustment({
        family: "rushing_yards",
        direction: "over",
        indoor: false,
        weather: badWeather,
      }),
    ).toBe(0);
  });

  it("treats indoor games as weather neutral", () => {
    expect(
      weatherProbabilityAdjustment({
        family: "passing_yards",
        direction: "over",
        indoor: true,
        weather: badWeather,
      }),
    ).toBe(0);
  });
});
