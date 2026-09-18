import "server-only";

import { unstable_cache } from "next/cache";
import type { CanonicalMarket } from "@/lib/markets/types";

type CsvRow = Record<string, string>;

export interface NflScheduleGame {
  gameId: string;
  season: number;
  week: number | null;
  seasonType: string;
  gameday: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  stadium: string | null;
  roof: string | null;
}

const ELIGIBLE_SEASON_TYPES = new Set(["REG", "WC", "DIV", "CON", "SB", "POST"]);

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

function easternKickoff(gameday: string, gametime: string | undefined) {
  const time = gametime || "13:00";
  const [year, month, day] = gameday.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(desiredLocalAsUtc);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);

  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const representedUtc = Date.UTC(
    valueOf("year"),
    valueOf("month") - 1,
    valueOf("day"),
    valueOf("hour"),
    valueOf("minute"),
  );
  const easternOffset = representedUtc - guess.getTime();
  const value = new Date(desiredLocalAsUtc - easternOffset);
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

export function isEligibleNflSeasonType(value: string) {
  return ELIGIBLE_SEASON_TYPES.has(value.toUpperCase());
}

export function findEligibleScheduleGame(
  canonical: CanonicalMarket | null,
  games: NflScheduleGame[],
  now = Date.now(),
) {
  if (!canonical?.matchup || !canonical.settlementDate) return null;

  const candidates = games
    .filter(
      (game) =>
        isEligibleNflSeasonType(game.seasonType) &&
        matchupKey(game.homeTeam, game.awayTeam) === canonical.matchup &&
        dateDistanceDays(game.gameday, canonical.settlementDate!) <= 2,
    )
    .filter((game) => new Date(game.kickoffAt).getTime() >= now - 8 * 60 * 60 * 1_000)
    .toSorted((first, second) => {
      const firstDate = dateDistanceDays(first.gameday, canonical.settlementDate!);
      const secondDate = dateDistanceDays(second.gameday, canonical.settlementDate!);
      if (firstDate !== secondDate) return firstDate - secondDate;
      return (
        Math.abs(new Date(first.kickoffAt).getTime() - now) -
        Math.abs(new Date(second.kickoffAt).getTime() - now)
      );
    });

  return candidates[0] ?? null;
}

export const loadNflSchedule = unstable_cache(
  async (): Promise<NflScheduleGame[]> => {
    const response = await fetch(
      "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
      {
        headers: { "User-Agent": "Lynerva/1.0 schedule-validation" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`nflverse schedule returned ${response.status}`);
    }

    const rows = parseCsv(await response.text());
    const games: NflScheduleGame[] = [];
    for (const row of rows) {
      if (
        !row.game_id ||
        !row.gameday ||
        !row.home_team ||
        !row.away_team ||
        !row.game_type
      ) {
        continue;
      }
      const kickoff = easternKickoff(row.gameday, row.gametime);
      if (!kickoff) continue;
      games.push({
        gameId: row.game_id,
        season: Number(row.season || 0),
        week: Number.isFinite(Number(row.week)) ? Number(row.week) : null,
        seasonType: row.game_type,
        gameday: row.gameday,
        kickoffAt: kickoff.toISOString(),
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        stadium: row.stadium || null,
        roof: row.roof || null,
      });
    }
    return games;
  },
  ["lynerva-nfl-schedule-v1"],
  { revalidate: 60 * 60 },
);
