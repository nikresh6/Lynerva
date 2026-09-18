import "server-only";

type CsvRow = Record<string, string>;

export interface HistoricalValue {
  season: number;
  week: number;
  value: number;
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

function numeric(row: CsvRow, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

let historySnapshot: { rows: CsvRow[]; loadedAt: number } | null = null;
let historyInFlight: Promise<CsvRow[]> | null = null;

async function fetchHistoryRows() {
  const currentSeason = new Date().getUTCFullYear();
  const seasons = [currentSeason, currentSeason - 1, currentSeason - 2];
  const rows: CsvRow[] = [];

  await Promise.all(
    seasons.map(async (season) => {
      const url =
        `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Lynerva/1.0 model-history" },
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) return;
        for (const row of parseCsv(await response.text())) {
          if ((row.season_type || row.seasonType || "").toUpperCase() !== "REG") {
            continue;
          }
          rows.push({ ...row, __season: String(season) });
        }
      } catch (error) {
        console.error(`nflverse history fetch failed for ${season}`, error);
      }
    }),
  );

  return rows;
}

async function loadHistory() {
  const now = Date.now();
  if (
    historySnapshot &&
    now - historySnapshot.loadedAt < 60 * 60 * 1_000
  ) {
    return historySnapshot.rows;
  }
  if (historyInFlight) return historyInFlight;

  historyInFlight = fetchHistoryRows()
    .then((rows) => {
      historySnapshot = {
        rows,
        loadedAt: rows.length ? Date.now() : Date.now() - 59 * 60 * 1_000,
      };
      return rows;
    })
    .finally(() => {
      historyInFlight = null;
    });

  return historyInFlight;
}

function statisticValue(row: CsvRow, statistic: string) {
  switch (statistic) {
    case "passing_yards":
      return numeric(row, "passing_yards");
    case "passing_touchdowns":
      return numeric(row, "passing_tds");
    case "rushing_yards":
      return numeric(row, "rushing_yards");
    case "receiving_yards":
      return numeric(row, "receiving_yards");
    case "receptions":
      return numeric(row, "receptions");
    case "touchdowns":
      return numeric(row, "rushing_tds") + numeric(row, "receiving_tds");
    default:
      return null;
  }
}

export async function findPublicPlayerHistory(
  subject: string,
  statistic: string,
) {
  const rows = await loadHistory();
  const normalizedSubject = normalizePerson(subject);

  const playerNames = new Map<string, string>();
  for (const row of rows) {
    const name = row.player_display_name || row.player_name;
    if (!name) continue;
    playerNames.set(normalizePerson(name), name);
  }

  const match = [...playerNames.entries()]
    .filter(
      ([normalized]) =>
        normalized.length >= 5 && normalizedSubject.includes(normalized),
    )
    .toSorted(([a], [b]) => b.length - a.length)[0];

  if (!match) {
    return { playerName: null, values: [] as HistoricalValue[] };
  }

  const [normalizedName, playerName] = match;
  const values = rows
    .filter((row) => {
      const name = row.player_display_name || row.player_name;
      return normalizePerson(name) === normalizedName;
    })
    .map((row): HistoricalValue | null => {
      const value = statisticValue(row, statistic);
      if (value === null) return null;
      return {
        season: Number(row.__season || row.season || 0),
        week: Number(row.week || 0),
        value,
      };
    })
    .filter((row): row is HistoricalValue => row !== null)
    .toSorted((a, b) => b.season - a.season || b.week - a.week)
    .slice(0, 24);

  return { playerName, values };
}
