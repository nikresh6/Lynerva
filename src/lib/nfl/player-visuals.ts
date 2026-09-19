import "server-only";

export interface PlayerVisual {
  imageUrl: string | null;
  team: string | null;
  position: string | null;
}

interface RosterPlayer extends PlayerVisual {
  fullName: string;
  footballName: string | null;
}

let rosterPromise: Promise<Map<string, RosterPlayer>> | null = null;

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

async function loadRoster() {
  const season = new Date().getUTCFullYear();
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
  const response = await fetch(url, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!response.ok) {
    throw new Error(`nflverse roster request failed: ${response.status}`);
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const index = (name: string) => header.indexOf(name);
  const fullNameIndex = index("full_name");
  const footballNameIndex = index("football_name");
  const imageIndex = index("headshot_url");
  const teamIndex = index("team");
  const positionIndex = index("position");
  const statusIndex = index("status");

  if (fullNameIndex < 0 || imageIndex < 0) {
    throw new Error("nflverse roster is missing expected player columns");
  }

  const players = new Map<string, RosterPlayer>();

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const fullName = row[fullNameIndex]?.trim();
    if (!fullName) continue;

    const status = statusIndex >= 0 ? row[statusIndex]?.trim() : "";
    const player: RosterPlayer = {
      fullName,
      footballName:
        footballNameIndex >= 0
          ? row[footballNameIndex]?.trim() || null
          : null,
      imageUrl: row[imageIndex]?.trim() || null,
      team: teamIndex >= 0 ? row[teamIndex]?.trim() || null : null,
      position:
        positionIndex >= 0 ? row[positionIndex]?.trim() || null : null,
    };

    const keys = [player.fullName, player.footballName]
      .filter((value): value is string => Boolean(value))
      .map(normalizePerson)
      .filter(Boolean);

    for (const key of keys) {
      const existing = players.get(key);
      const existingActive = existing ? true : false;
      const active = /ACT|active/i.test(status ?? "");
      if (!existing || (active && !existingActive)) {
        players.set(key, player);
      }
    }
  }

  return players;
}

async function rosterMap() {
  if (!rosterPromise) {
    rosterPromise = loadRoster().catch((error) => {
      rosterPromise = null;
      throw error;
    });
  }
  return rosterPromise;
}

function fuzzyMatch(
  normalized: string,
  players: Map<string, RosterPlayer>,
) {
  if (normalized.length < 5) return null;
  let best: RosterPlayer | null = null;
  let bestLength = 0;

  for (const [key, player] of players) {
    if (
      key.length >= 5 &&
      (key.includes(normalized) || normalized.includes(key)) &&
      key.length > bestLength
    ) {
      best = player;
      bestLength = key.length;
    }
  }
  return best;
}

export async function getPlayerVisuals(names: string[]) {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const result: Record<string, PlayerVisual | null> = {};

  if (!unique.length) return result;

  try {
    const players = await rosterMap();
    for (const name of unique) {
      const normalized = normalizePerson(name);
      const player =
        players.get(normalized) ?? fuzzyMatch(normalized, players);
      result[name] = player
        ? {
            imageUrl: player.imageUrl,
            team: player.team,
            position: player.position,
          }
        : null;
    }
  } catch (error) {
    console.error("Player visual lookup failed", error);
    for (const name of unique) result[name] = null;
  }

  return result;
}
