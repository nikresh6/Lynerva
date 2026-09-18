import "server-only";

import { z } from "zod";
import { fetchValidated } from "@/lib/providers/http";

const competitorSchema = z
  .object({
    id: z.string(),
    homeAway: z.enum(["home", "away"]),
    score: z.string().optional().default("0"),
    possession: z.boolean().optional().default(false),
    team: z.object({
      abbreviation: z.string(),
      displayName: z.string(),
    }),
  })
  .passthrough();

const eventSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    date: z.string(),
    season: z
      .object({
        year: z.number(),
        type: z.number(),
      })
      .optional(),
    week: z.object({ number: z.number() }).optional(),
    status: z.object({
      type: z.object({
        state: z.string(),
        detail: z.string(),
        completed: z.boolean(),
      }),
      period: z.number().optional().default(0),
      displayClock: z.string().optional().default(""),
    }),
    competitions: z.array(
      z.object({ competitors: z.array(competitorSchema) }).passthrough(),
    ),
  })
  .passthrough();

const scoreboardSchema = z.object({ events: z.array(eventSchema).default([]) }).passthrough();

export interface LiveNflGame {
  id: string;
  name: string;
  startsAt: string;
  seasonYear: number | null;
  seasonType: number | null;
  week: number | null;
  state: string;
  status: string;
  period: number;
  clock: string;
  home: { team: string; score: number };
  away: { team: string; score: number };
  possession: string | null;
  updatedAt: string;
}

export interface LiveNflProvider {
  getGames(): Promise<LiveNflGame[]>;
}

export class EspnLiveNflProvider implements LiveNflProvider {
  async getGames() {
    const updatedAt = new Date().toISOString();
    const payload = await fetchValidated(
      "ESPN",
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
      scoreboardSchema,
      { cache: "no-store" },
    );
    return payload.events.map((event) => {
      const competitors = event.competitions[0]?.competitors ?? [];
      const home = competitors.find((team) => team.homeAway === "home");
      const away = competitors.find((team) => team.homeAway === "away");
      const possession = competitors.find((team) => team.possession);
      return {
        id: event.id,
        name: event.name,
        startsAt: event.date,
        seasonYear: event.season?.year ?? null,
        seasonType: event.season?.type ?? null,
        week: event.week?.number ?? null,
        state: event.status.type.state,
        status: event.status.type.detail,
        period: event.status.period,
        clock: event.status.displayClock,
        home: {
          team: home?.team.abbreviation ?? "—",
          score: Number(home?.score ?? 0),
        },
        away: {
          team: away?.team.abbreviation ?? "—",
          score: Number(away?.score ?? 0),
        },
        possession: possession?.team.abbreviation ?? null,
        updatedAt,
      };
    });
  }
}

export async function getLiveNflGames() {
  try {
    return await new EspnLiveNflProvider().getGames();
  } catch (error) {
    console.error("Live NFL state unavailable", error);
    return [];
  }
}
