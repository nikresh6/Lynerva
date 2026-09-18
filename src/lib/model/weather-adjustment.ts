import type { CanonicalMarket } from "@/lib/markets/types";
import type { WeatherPoint } from "@/lib/weather";

export function weatherProbabilityAdjustment(input: {
  family: CanonicalMarket["family"];
  direction: CanonicalMarket["direction"];
  indoor: boolean;
  weather: WeatherPoint | null;
}) {
  if (input.indoor || !input.weather) return 0;
  if (
    ![
      "passing_yards",
      "passing_touchdowns",
      "receiving_yards",
      "receptions",
    ].includes(input.family)
  ) {
    return 0;
  }

  let adverse = 0;
  if (input.weather.windMph >= 25) adverse += 0.035;
  else if (input.weather.windMph >= 20) adverse += 0.025;
  else if (input.weather.windMph >= 15) adverse += 0.012;

  if (input.weather.precipitationProbability >= 80) adverse += 0.012;
  else if (input.weather.precipitationProbability >= 50) adverse += 0.006;

  if (input.weather.temperatureF <= 20) adverse += 0.006;
  else if (input.weather.temperatureF <= 32) adverse += 0.003;

  if (input.weather.severe) adverse += 0.008;

  const capped = Math.min(adverse, 0.045);
  if (capped === 0) return 0;
  return input.direction === "under" ? capped : -capped;
}
