import { getLiveNflGames } from "@/lib/nfl/live";
import { getWeatherForGame } from "@/lib/nfl/game-context";
import { weatherProbabilityAdjustment } from "@/lib/model/weather-adjustment";
import type { Direction, MarketFamily, MarketSide } from "@/lib/markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matchupKey(first: string, second: string) {
  return [first, second].toSorted().join("-");
}

function weatherLabel(code: number) {
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([45, 48].includes(code)) return "Fog";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  return "Clear";
}

function impactText(adjustment: number, indoor: boolean) {
  if (indoor) {
    return {
      tone: "neutral",
      label: "No weather impact",
      detail: "This game is indoors or in a retractable-roof stadium, so weather should not matter much.",
    };
  }
  const magnitude = Math.abs(adjustment);
  if (magnitude < 0.005) {
    return {
      tone: "neutral",
      label: "Little weather impact",
      detail: "The forecast is mild enough that weather should not meaningfully change this pick.",
    };
  }
  if (adjustment > 0) {
    return {
      tone: "positive",
      label: magnitude >= 0.025 ? "Weather helps this pick" : "Weather slightly helps",
      detail: "The forecast leans in the same direction as this pick.",
    };
  }
  return {
    tone: "negative",
    label: magnitude >= 0.025 ? "Weather hurts this pick" : "Weather slightly hurts",
    detail: "The forecast leans against this pick.",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const matchup = url.searchParams.get("matchup") ?? "";
  const family = (url.searchParams.get("family") ?? "other") as MarketFamily;
  const direction = (url.searchParams.get("direction") ?? "yes") as Direction;
  const side = (url.searchParams.get("side") ?? "yes") as MarketSide;

  if (!matchup) {
    return Response.json({ available: false }, { status: 400 });
  }

  const games = await getLiveNflGames();
  const game = games.find(
    (item) =>
      item.state !== "post" &&
      matchupKey(item.home.team, item.away.team) === matchup,
  );

  if (!game) {
    return Response.json(
      {
        available: false,
        message: "Weather is not available for this matchup yet.",
      },
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  }

  const weatherContext = await Promise.race([
    getWeatherForGame(game.home.team, game.away.team, game.startsAt),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_800)),
  ]);

  if (!weatherContext) {
    return Response.json(
      {
        available: false,
        message: "Weather forecast is taking too long to load.",
      },
      { headers: { "Cache-Control": "public, s-maxage=120" } },
    );
  }

  const rawAdjustment = weatherProbabilityAdjustment({
    family,
    direction,
    indoor: weatherContext.indoor,
    weather: weatherContext.weather,
  });
  const pickAdjustment = side === "no" ? -rawAdjustment : rawAdjustment;
  const impact = impactText(pickAdjustment, weatherContext.indoor);

  return Response.json(
    {
      available: true,
      indoor: weatherContext.indoor,
      kickoffAt: game.startsAt,
      condition: weatherContext.indoor
        ? "Indoor"
        : weatherContext.weather
          ? weatherLabel(weatherContext.weather.weatherCode)
          : "Forecast unavailable",
      temperatureF: weatherContext.weather?.temperatureF ?? null,
      windMph: weatherContext.weather?.windMph ?? null,
      rainChance: weatherContext.weather?.precipitationProbability ?? null,
      impact,
    },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } },
  );
}
