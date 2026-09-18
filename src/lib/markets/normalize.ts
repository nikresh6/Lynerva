import type {
  CanonicalMarket,
  Direction,
  MarketFamily,
  ProviderMarket,
} from "./types";

const TEAM_ALIASES: Record<string, string> = {
  arizona: "ARI",
  cardinals: "ARI",
  atlanta: "ATL",
  falcons: "ATL",
  baltimore: "BAL",
  ravens: "BAL",
  buffalo: "BUF",
  bills: "BUF",
  carolina: "CAR",
  panthers: "CAR",
  chicago: "CHI",
  bears: "CHI",
  cincinnati: "CIN",
  bengals: "CIN",
  cleveland: "CLE",
  browns: "CLE",
  dallas: "DAL",
  cowboys: "DAL",
  denver: "DEN",
  broncos: "DEN",
  detroit: "DET",
  lions: "DET",
  "green bay": "GB",
  packers: "GB",
  houston: "HOU",
  texans: "HOU",
  indianapolis: "IND",
  colts: "IND",
  jacksonville: "JAX",
  jaguars: "JAX",
  "kansas city": "KC",
  chiefs: "KC",
  "las vegas": "LV",
  raiders: "LV",
  chargers: "LAC",
  rams: "LAR",
  miami: "MIA",
  dolphins: "MIA",
  minnesota: "MIN",
  vikings: "MIN",
  "new england": "NE",
  patriots: "NE",
  "new orleans": "NO",
  saints: "NO",
  giants: "NYG",
  jets: "NYJ",
  philadelphia: "PHI",
  eagles: "PHI",
  pittsburgh: "PIT",
  steelers: "PIT",
  "san francisco": "SF",
  "49ers": "SF",
  seattle: "SEA",
  seahawks: "SEA",
  tampa: "TB",
  buccaneers: "TB",
  tennessee: "TEN",
  titans: "TEN",
  washington: "WAS",
  commanders: "WAS",
};

const STAT_PATTERNS: Array<{
  family: MarketFamily;
  statistic: string;
  regex: RegExp;
}> = [
  { family: "passing_yards", statistic: "passing_yards", regex: /pass(?:ing)?\s+yards?/i },
  { family: "passing_touchdowns", statistic: "passing_touchdowns", regex: /pass(?:ing)?\s+(?:tds?|touchdowns?)/i },
  { family: "rushing_yards", statistic: "rushing_yards", regex: /rush(?:ing)?\s+yards?/i },
  { family: "receiving_yards", statistic: "receiving_yards", regex: /receiv(?:ing)?\s+yards?/i },
  { family: "receptions", statistic: "receptions", regex: /receptions?|catches/i },
  { family: "touchdowns", statistic: "touchdowns", regex: /(?:anytime\s+)?touchdowns?|\btds?\b/i },
];

function compact(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.+-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findTeams(value: string) {
  const normalized = compact(value);
  const teams = new Set<string>();
  const aliases = Object.entries(TEAM_ALIASES).toSorted(
    ([a], [b]) => b.length - a.length,
  );
  for (const [alias, code] of aliases) {
    if (new RegExp(`\\b${alias.replace(" ", "\\s+")}\\b`, "i").test(normalized)) {
      teams.add(code);
    }
  }
  return [...teams];
}

function findThreshold(value: string) {
  const candidates = [
    /(?:over|under|more than|fewer than|at least)\s+(-?\d+(?:\.5)?)/i,
    /(-?\d+(?:\.5)?)\s*\+/,
    /(?:line|spread|total)\s*(?:of|:)?\s*(-?\d+(?:\.5)?)/i,
  ];
  for (const pattern of candidates) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function findDirection(value: string): Direction {
  if (/\b(?:under|fewer than|less than)\b/i.test(value)) return "under";
  if (/\b(?:over|more than|at least)\b|\d\s*\+/i.test(value)) return "over";
  if (/\bno\b/i.test(value)) return "no";
  return "yes";
}

function familyFrom(value: string): { family: MarketFamily; statistic: string | null } {
  for (const item of STAT_PATTERNS) {
    if (item.regex.test(value)) return item;
  }
  if (/spread|win by|margin/i.test(value)) return { family: "spread", statistic: "point_margin" };
  if (/total points|game total|combined score|o\/u/i.test(value)) {
    return { family: "game_total", statistic: "game_points" };
  }
  if (/moneyline|to win|will .* win|winner/i.test(value)) {
    return { family: "moneyline", statistic: "game_winner" };
  }
  return { family: "other", statistic: null };
}

function findSubject(value: string, family: MarketFamily, teams: string[]) {
  if (["moneyline", "spread"].includes(family) && teams.length) return teams[0];
  if (family === "game_total" && teams.length >= 2) return teams.toSorted().join("-");

  const firstClause = value
    .replace(/^\s*(?:yes|no)\s+/i, "")
    .replace(/will\s+/i, "")
    .split(/(?:\s+(?:over|under|to record|to have|at least|more than)\s+|\s+\d)/i)[0]
    ?.replace(/[?:-]+$/g, "")
    .replace(/\b(?:record|have|get|finish with)\s*$/i, "")
    .trim();
  return (firstClause || value).trim().slice(0, 80);
}

function settlementDate(market: ProviderMarket) {
  if (!market.closesAt) return null;
  const date = new Date(market.closesAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function regulationOnly(rules: string | null) {
  if (!rules) return null;
  if (/including overtime|overtime counts|includes? (?:ot|overtime)/i.test(rules)) return false;
  if (/regulation only|excluding overtime|does not include overtime/i.test(rules)) return true;
  return null;
}

export function normalizeMarket(market: ProviderMarket): CanonicalMarket | null {
  const combined = `${market.eventTitle} ${market.marketTitle} ${market.outcomeLabel}`;
  const contractText = `${market.marketTitle} ${market.outcomeLabel}`;
  const { family, statistic } = familyFrom(combined);
  if (family === "other") return null;
  const teams = findTeams(combined);
  const contractTeams = findTeams(contractText);
  const threshold = findThreshold(contractText);
  const direction = findDirection(contractText);
  const subject = findSubject(
    contractText,
    family,
    contractTeams.length ? contractTeams : teams,
  );
  const matchup = teams.length >= 2 ? teams.slice(0, 2).toSorted().join("-") : null;
  const date = settlementDate(market);
  const regulation = regulationOnly(market.resolutionRules);
  const keyParts = [
    "nfl",
    date ?? "unknown-date",
    matchup ?? "unknown-matchup",
    family,
    statistic ?? "na",
    compact(subject),
    direction,
    threshold ?? "na",
    regulation === null ? "rule-unknown" : regulation ? "regulation" : "includes-ot",
  ];
  const strong =
    date !== null &&
    (matchup !== null || subject.length > 3) &&
    (family === "moneyline" || threshold !== null);
  return {
    key: keyParts.join(":"),
    family,
    statistic,
    direction,
    threshold,
    subject,
    matchup,
    settlementDate: date,
    regulationOnly: regulation,
    parseConfidence: strong ? "high" : date ? "medium" : "low",
  };
}

export function settlementRulesMatch(
  first: CanonicalMarket,
  second: CanonicalMarket,
) {
  if (first.parseConfidence !== "high" || second.parseConfidence !== "high") return false;
  if (first.key !== second.key) return false;
  if (
    first.regulationOnly === null ||
    second.regulationOnly === null ||
    first.regulationOnly !== second.regulationOnly
  ) {
    return false;
  }
  return true;
}

export function isNflText(...values: Array<string | null | undefined>) {
  const value = values.filter(Boolean).join(" ");

  if (/\bnfl\b|KXNFL|super bowl/i.test(value)) return true;

  const fullFranchise =
    /arizona cardinals|atlanta falcons|baltimore ravens|buffalo bills|carolina panthers|chicago bears|cincinnati bengals|cleveland browns|dallas cowboys|denver broncos|detroit lions|green bay packers|houston texans|indianapolis colts|jacksonville jaguars|kansas city chiefs|las vegas raiders|los angeles chargers|los angeles rams|miami dolphins|minnesota vikings|new england patriots|new orleans saints|new york giants|new york jets|philadelphia eagles|pittsburgh steelers|san francisco 49ers|seattle seahawks|tampa bay buccaneers|tennessee titans|washington commanders/i;
  if (fullFranchise.test(value)) return true;

  const nicknameMatches =
    value.match(
      /\b(?:cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|chargers|rams|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|49ers|seahawks|buccaneers|titans|commanders)\b/gi,
    ) ?? [];
  return new Set(nicknameMatches.map((name) => name.toLowerCase())).size >= 2;
}

export function canonicalKeyWithoutRules(market: CanonicalMarket) {
  return [
    market.settlementDate,
    market.matchup,
    market.family,
    market.statistic,
    compact(market.subject),
    market.direction,
    market.threshold,
  ].join(":");
}
