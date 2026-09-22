import "server-only";

import { z } from "zod";
import { fetchValidated } from "@/lib/providers/http";

const competitorSchema = z
  .object({
    id: z.string(),
    homeAway: z.enum(["home", "away"]),
    score: z.string().optional().default("0"),
    possession: z.boolean().optional().default(false),
    timeouts: z.coerce.number().optional(),
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
      z
        .object({
          competitors: z.array(competitorSchema),
          situation: z
            .object({
              possession: z.string().optional(),
              down: z.coerce.number().optional(),
              distance: z.coerce.number().optional(),
              yardLine: z.coerce.number().optional(),
              possessionText: z.string().optional(),
              isRedZone: z.boolean().optional(),
              homeTimeouts: z.coerce.number().optional(),
              awayTimeouts: z.coerce.number().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
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
  home: { team: string; score: number; timeouts?: number | null };
  away: { team: string; score: number; timeouts?: number | null };
  possession: string | null;
  down?: number | null;
  distance?: number | null;
  yardLine?: number | null;
  possessionText?: string | null;
  isRedZone?: boolean | null;
  updatedAt: string;
}

export interface LiveNflProvider {
  getGames(options?: { season?: number; week?: number }): Promise<LiveNflGame[]>;
}

export class EspnLiveNflProvider implements LiveNflProvider {
  async getGames(options?: { season?: number; week?: number }) {
    const updatedAt = new Date().toISOString();
    const params = new URLSearchParams();
    if (options?.season) params.set("dates", String(options.season));
    if (options?.week) {
      params.set("seasontype", "2");
      params.set("week", String(options.week));
    }
    const query = params.size ? `?${params.toString()}` : "";
    const payload = await fetchValidated(
      "ESPN",
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard${query}`,
      scoreboardSchema,
      { cache: "no-store" },
    );
    return payload.events.map((event) => {
      const competition = event.competitions[0];
      const competitors = competition?.competitors ?? [];
      const situation = competition?.situation;
      const home = competitors.find((team) => team.homeAway === "home");
      const away = competitors.find((team) => team.homeAway === "away");
      const possession =
        competitors.find((team) => team.possession) ??
        competitors.find((team) => team.id === situation?.possession);
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
          timeouts: situation?.homeTimeouts ?? home?.timeouts ?? null,
        },
        away: {
          team: away?.team.abbreviation ?? "—",
          score: Number(away?.score ?? 0),
          timeouts: situation?.awayTimeouts ?? away?.timeouts ?? null,
        },
        possession: possession?.team.abbreviation ?? null,
        down: situation?.down ?? null,
        distance: situation?.distance ?? null,
        yardLine: situation?.yardLine ?? null,
        possessionText: situation?.possessionText ?? null,
        isRedZone: situation?.isRedZone ?? null,
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

export async function getActiveNflSlateGames() {
  const provider = new EspnLiveNflProvider();

  try {
    const current = await provider.getGames();
    const regular = current.filter(
      (game) => game.seasonType === 2 && game.week !== null,
    );

    // ESPN's default scoreboard can keep the just-finished week selected until
    // Wednesday. If there is still a live or upcoming regular-season game,
    // keep that week. Once every game is final, advance immediately.
    if (
      regular.length === 0 ||
      regular.some((game) => game.state === "in" || game.state === "pre")
    ) {
      return current;
    }

    const season = regular.find((game) => game.seasonYear !== null)?.seasonYear;
    const week = Math.max(...regular.map((game) => game.week ?? 0));
    if (!season || week < 1 || week >= 18) return current;

    const next = await provider.getGames({ season, week: week + 1 });
    const nextRegular = next.filter(
      (game) =>
        game.seasonType === 2 &&
        game.seasonYear === season &&
        game.week === week + 1,
    );

    return nextRegular.length ? nextRegular : current;
  } catch (error) {
    console.error("Active NFL slate unavailable", error);
    return getLiveNflGames();
  }
}
