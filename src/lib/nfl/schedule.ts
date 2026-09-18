import "server-only";

import type { NflScheduleGame } from "./schedule-match";

type CsvRow = Record<string, string>;

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

let scheduleCache: { games: NflScheduleGame[]; storedAt: number } | null = null;

export async function loadNflSchedule(): Promise<NflScheduleGame[]> {
  if (scheduleCache && Date.now() - scheduleCache.storedAt < 60 * 60 * 1_000) {
    return scheduleCache.games;
  }

  const games = await (async (): Promise<NflScheduleGame[]> => {
    const response = await fetch(
      "https://cdn.jsdelivr.net/gh/nflverse/nfldata@master/data/games.csv",
      {
        headers: { "User-Agent": "Lynerva/1.0 schedule-validation" },
        signal: AbortSignal.timeout(5_000),
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
  })();

  scheduleCache = { games, storedAt: Date.now() };
  return games;
}
