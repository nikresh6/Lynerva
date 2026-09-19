export interface NflTeamMeta {
  code: string;
  city: string;
  name: string;
  fullName: string;
  aliases: string[];
}

export const NFL_TEAMS: NflTeamMeta[] = [
  { code: "ARI", city: "Arizona", name: "Cardinals", fullName: "Arizona Cardinals", aliases: ["ari", "arizona", "cardinals", "arizona cardinals"] },
  { code: "ATL", city: "Atlanta", name: "Falcons", fullName: "Atlanta Falcons", aliases: ["atl", "atlanta", "falcons", "atlanta falcons"] },
  { code: "BAL", city: "Baltimore", name: "Ravens", fullName: "Baltimore Ravens", aliases: ["bal", "baltimore", "ravens", "baltimore ravens"] },
  { code: "BUF", city: "Buffalo", name: "Bills", fullName: "Buffalo Bills", aliases: ["buf", "buffalo", "bills", "buffalo bills"] },
  { code: "CAR", city: "Carolina", name: "Panthers", fullName: "Carolina Panthers", aliases: ["car", "carolina", "panthers", "carolina panthers"] },
  { code: "CHI", city: "Chicago", name: "Bears", fullName: "Chicago Bears", aliases: ["chi", "chicago", "bears", "chicago bears"] },
  { code: "CIN", city: "Cincinnati", name: "Bengals", fullName: "Cincinnati Bengals", aliases: ["cin", "cincinnati", "bengals", "cincinnati bengals"] },
  { code: "CLE", city: "Cleveland", name: "Browns", fullName: "Cleveland Browns", aliases: ["cle", "cleveland", "browns", "cleveland browns"] },
  { code: "DAL", city: "Dallas", name: "Cowboys", fullName: "Dallas Cowboys", aliases: ["dal", "dallas", "cowboys", "dallas cowboys"] },
  { code: "DEN", city: "Denver", name: "Broncos", fullName: "Denver Broncos", aliases: ["den", "denver", "broncos", "denver broncos"] },
  { code: "DET", city: "Detroit", name: "Lions", fullName: "Detroit Lions", aliases: ["det", "detroit", "lions", "detroit lions"] },
  { code: "GB", city: "Green Bay", name: "Packers", fullName: "Green Bay Packers", aliases: ["gb", "green bay", "packers", "green bay packers"] },
  { code: "HOU", city: "Houston", name: "Texans", fullName: "Houston Texans", aliases: ["hou", "houston", "texans", "houston texans"] },
  { code: "IND", city: "Indianapolis", name: "Colts", fullName: "Indianapolis Colts", aliases: ["ind", "indianapolis", "colts", "indianapolis colts"] },
  { code: "JAX", city: "Jacksonville", name: "Jaguars", fullName: "Jacksonville Jaguars", aliases: ["jax", "jacksonville", "jaguars", "jags", "jacksonville jaguars"] },
  { code: "KC", city: "Kansas City", name: "Chiefs", fullName: "Kansas City Chiefs", aliases: ["kc", "kansas city", "chiefs", "kansas city chiefs"] },
  { code: "LV", city: "Las Vegas", name: "Raiders", fullName: "Las Vegas Raiders", aliases: ["lv", "las vegas", "raiders", "las vegas raiders"] },
  { code: "LAC", city: "Los Angeles", name: "Chargers", fullName: "Los Angeles Chargers", aliases: ["lac", "chargers", "la chargers", "los angeles chargers"] },
  { code: "LAR", city: "Los Angeles", name: "Rams", fullName: "Los Angeles Rams", aliases: ["lar", "rams", "la rams", "los angeles rams"] },
  { code: "MIA", city: "Miami", name: "Dolphins", fullName: "Miami Dolphins", aliases: ["mia", "miami", "dolphins", "miami dolphins"] },
  { code: "MIN", city: "Minnesota", name: "Vikings", fullName: "Minnesota Vikings", aliases: ["min", "minnesota", "vikings", "minnesota vikings"] },
  { code: "NE", city: "New England", name: "Patriots", fullName: "New England Patriots", aliases: ["ne", "new england", "patriots", "pats", "new england patriots"] },
  { code: "NO", city: "New Orleans", name: "Saints", fullName: "New Orleans Saints", aliases: ["no", "new orleans", "saints", "new orleans saints"] },
  { code: "NYG", city: "New York", name: "Giants", fullName: "New York Giants", aliases: ["nyg", "giants", "new york giants", "ny giants"] },
  { code: "NYJ", city: "New York", name: "Jets", fullName: "New York Jets", aliases: ["nyj", "jets", "new york jets", "ny jets"] },
  { code: "PHI", city: "Philadelphia", name: "Eagles", fullName: "Philadelphia Eagles", aliases: ["phi", "philadelphia", "eagles", "philly", "philadelphia eagles"] },
  { code: "PIT", city: "Pittsburgh", name: "Steelers", fullName: "Pittsburgh Steelers", aliases: ["pit", "pittsburgh", "steelers", "pittsburgh steelers"] },
  { code: "SF", city: "San Francisco", name: "49ers", fullName: "San Francisco 49ers", aliases: ["sf", "san francisco", "49ers", "niners", "san francisco 49ers"] },
  { code: "SEA", city: "Seattle", name: "Seahawks", fullName: "Seattle Seahawks", aliases: ["sea", "seattle", "seahawks", "seattle seahawks"] },
  { code: "TB", city: "Tampa Bay", name: "Buccaneers", fullName: "Tampa Bay Buccaneers", aliases: ["tb", "tampa bay", "buccaneers", "bucs", "tampa bay buccaneers"] },
  { code: "TEN", city: "Tennessee", name: "Titans", fullName: "Tennessee Titans", aliases: ["ten", "tennessee", "titans", "tennessee titans"] },
  { code: "WAS", city: "Washington", name: "Commanders", fullName: "Washington Commanders", aliases: ["was", "wsh", "washington", "commanders", "washington commanders"] },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getNflTeam(code: string) {
  const normalized = code.toUpperCase() === "WSH" ? "WAS" : code.toUpperCase();
  return NFL_TEAMS.find((team) => team.code === normalized) ?? null;
}

export function resolveNflTeamQuery(query: string) {
  const normalized = normalize(query);
  if (!normalized) return null;
  return (
    NFL_TEAMS.find((team) =>
      team.aliases.some((alias) => normalize(alias) === normalized),
    ) ?? null
  );
}

export function findNflTeamsInQuery(query: string) {
  const normalized = ` ${normalize(query)} `;
  if (!normalized.trim()) return [];

  return NFL_TEAMS.filter((team) =>
    team.aliases.some((alias) => {
      const candidate = normalize(alias);
      if (candidate.length < 3) {
        return normalize(query) === candidate;
      }
      return normalized.includes(` ${candidate} `);
    }),
  );
}
