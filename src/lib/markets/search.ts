import {
  NFL_TEAMS,
  findNflTeamsInQuery,
  type NflTeamMeta,
} from "@/lib/nfl/teams";
import type {
  Direction,
  MarketFamily,
  MarketOpportunity,
} from "./types";

const FAMILY_LABELS: Partial<Record<MarketFamily, string>> = {
  moneyline: "moneyline",
  passing_yards: "passing yards",
  passing_touchdowns: "passing touchdowns",
  passing_interceptions: "interceptions",
  rushing_yards: "rushing yards",
  rushing_touchdowns: "rushing touchdowns",
  receiving_yards: "receiving yards",
  receiving_touchdowns: "receiving touchdowns",
  receptions: "receptions",
  longest_reception: "longest reception",
  touchdowns: "anytime touchdowns",
};

const FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "bet",
  "bets",
  "for",
  "game",
  "market",
  "markets",
  "nfl",
  "of",
  "on",
  "player",
  "players",
  "prop",
  "props",
  "the",
  "to",
  "vs",
  "v",
  "at",
]);

const FAMILY_PHRASES: Array<{
  families: MarketFamily[];
  patterns: RegExp[];
}> = [
  {
    families: ["longest_reception"],
    patterns: [
      /\blongest reception\b/,
      /\blong reception\b/,
      /\blongest catch\b/,
      /\blong catch\b/,
    ],
  },
  {
    families: ["passing_yards"],
    patterns: [/\bpassing yards\b/, /\bpass yards\b/],
  },
  {
    families: ["passing_touchdowns"],
    patterns: [
      /\bpassing touchdowns?\b/,
      /\bpass touchdowns?\b/,
      /\bpassing td\b/,
      /\bpass td\b/,
    ],
  },
  {
    families: ["passing_interceptions"],
    patterns: [
      /\bpassing interceptions?\b/,
      /\binterceptions?\b/,
      /\bints?\b/,
      /\bpicks?\b/,
    ],
  },
  {
    families: ["rushing_yards"],
    patterns: [/\brushing yards\b/, /\brush yards\b/],
  },
  {
    families: ["rushing_touchdowns"],
    patterns: [
      /\brushing touchdowns?\b/,
      /\brush touchdowns?\b/,
      /\brushing td\b/,
      /\brush td\b/,
    ],
  },
  {
    families: ["receiving_yards"],
    patterns: [
      /\breceiving yards\b/,
      /\breceive yards\b/,
      /\brec yards\b/,
    ],
  },
  {
    families: ["receiving_touchdowns"],
    patterns: [
      /\breceiving touchdowns?\b/,
      /\breceiving td\b/,
      /\brec touchdown\b/,
      /\brec td\b/,
    ],
  },
  {
    families: ["receptions"],
    patterns: [
      /\breceptions?\b/,
      /\brecs?\b/,
      /\bcatches?\b/,
    ],
  },
  {
    families: ["touchdowns"],
    patterns: [
      /\banytime touchdowns?\b/,
      /\banytime td\b/,
      /\btd scorer\b/,
      /\bscore a touchdown\b/,
      /\btouchdowns?\b/,
      /\btds?\b/,
    ],
  },
  {
    families: ["moneyline"],
    patterns: [
      /\bmoneyline\b/,
      /\bmoney line\b/,
      /\bml\b/,
    ],
  },
];

const GENERIC_FAMILY_PHRASES: Array<{
  families: MarketFamily[];
  patterns: RegExp[];
}> = [
  {
    families: [
      "passing_yards",
      "passing_touchdowns",
      "passing_interceptions",
    ],
    patterns: [/\bpassing\b/, /\bpass\b/],
  },
  {
    families: ["rushing_yards", "rushing_touchdowns"],
    patterns: [/\brushing\b/, /\brush\b/],
  },
  {
    families: [
      "receiving_yards",
      "receiving_touchdowns",
      "receptions",
      "longest_reception",
    ],
    patterns: [/\breceiving\b/, /\breceiver\b/],
  },
];

export interface MarketSearchIntent {
  raw: string;
  normalized: string;
  teams: NflTeamMeta[];
  families: MarketFamily[];
  direction: "over" | "under" | null;
  threshold: number | null;
  terms: string[];
}

export function marketFamilyLabel(family: MarketFamily) {
  return FAMILY_LABELS[family] ?? family.replaceAll("_", " ");
}

export function normalizeMarketSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bmoney\s+line\b/g, "moneyline")
    .replace(/\bpassing\s+yds?\b/g, "passing yards")
    .replace(/\bpass\s+yds?\b/g, "passing yards")
    .replace(/\brushing\s+yds?\b/g, "rushing yards")
    .replace(/\brush\s+yds?\b/g, "rushing yards")
    .replace(/\breceiving\s+yds?\b/g, "receiving yards")
    .replace(/\brec\s+yds?\b/g, "receiving yards")
    .replace(/\byds?\b/g, "yards")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function regexMatches(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function removePatterns(text: string, patterns: RegExp[]) {
  return patterns.reduce(
    (current, pattern) => current.replace(new RegExp(pattern.source, "g"), " "),
    text,
  );
}

function removeTeamAliases(text: string, team: NflTeamMeta) {
  const aliases = [...team.aliases, team.code]
    .map(normalizeMarketSearch)
    .filter(Boolean)
    .toSorted((first, second) => second.length - first.length);

  return aliases.reduce((current, alias) => {
    const escaped = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return current.replace(new RegExp("\\b" + escaped + "\\b", "g"), " ");
  }, text);
}

export function parseMarketSearchQuery(query: string): MarketSearchIntent {
  const normalized = normalizeMarketSearch(query);
  if (!normalized) {
    return {
      raw: query,
      normalized,
      teams: [],
      families: [],
      direction: null,
      threshold: null,
      terms: [],
    };
  }

  const teams = findNflTeamsInQuery(normalized);
  let working = normalized;

  for (const team of teams) {
    working = removeTeamAliases(working, team);
  }

  let families: MarketFamily[] = [];
  for (const candidate of FAMILY_PHRASES) {
    if (!regexMatches(working, candidate.patterns)) continue;
    families = candidate.families;
    working = removePatterns(working, candidate.patterns);
    break;
  }

  if (!families.length) {
    for (const candidate of GENERIC_FAMILY_PHRASES) {
      if (!regexMatches(working, candidate.patterns)) continue;
      families = candidate.families;
      working = removePatterns(working, candidate.patterns);
      break;
    }
  }

  const direction: "over" | "under" | null = /\bover\b/.test(working)
    ? "over"
    : /\bunder\b/.test(working)
      ? "under"
      : null;
  working = working.replace(/\b(?:over|under)\b/g, " ");

  const numberMatch = working.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  const threshold = numberMatch ? Number(numberMatch[1]) : null;
  if (numberMatch) {
    working = working.replace(numberMatch[0], " ");
  }

  const terms = working
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !FILLER_TOKENS.has(token));

  return {
    raw: query,
    normalized,
    teams,
    families,
    direction,
    threshold: Number.isFinite(threshold) ? threshold : null,
    terms,
  };
}

function normalizePlayerIdentity(value: string) {
  return normalizeMarketSearch(value)
    .replace(/\b(?:jr|sr|ii|iii|iv)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinWithinOne(first: string, second: string) {
  if (first === second) return true;
  if (Math.abs(first.length - second.length) > 1) return false;

  let differences = 0;
  let left = 0;
  let right = 0;

  while (left < first.length && right < second.length) {
    if (first[left] === second[right]) {
      left += 1;
      right += 1;
      continue;
    }

    differences += 1;
    if (differences > 1) return false;

    if (first.length > second.length) left += 1;
    else if (second.length > first.length) right += 1;
    else {
      left += 1;
      right += 1;
    }
  }

  if (left < first.length || right < second.length) differences += 1;
  return differences <= 1;
}

function tokenMatches(token: string, haystack: string) {
  if (haystack.includes(token)) return true;
  if (token.length < 5) return false;

  return haystack
    .split(/\s+/)
    .filter((candidate) => candidate.length >= 4)
    .some((candidate) => levenshteinWithinOne(token, candidate));
}

function userFacingDirection(market: MarketOpportunity): Direction | null {
  const canonical = market.canonical;
  if (!canonical) return null;
  if (canonical.direction !== "over" && canonical.direction !== "under") {
    return canonical.direction;
  }
  if (market.recommendedSide !== "no") return canonical.direction;
  return canonical.direction === "over" ? "under" : "over";
}

function teamSearchText(code: string) {
  const team = NFL_TEAMS.find((candidate) => candidate.code === code);
  if (!team) return code;
  return [team.code, team.city, team.name, team.fullName, ...team.aliases].join(
    " ",
  );
}

export function marketSearchText(market: MarketOpportunity) {
  const canonical = market.canonical;
  const matchupTeams = canonical?.matchup?.split("-").filter(Boolean) ?? [];
  return normalizeMarketSearch(
    [
      market.eventTitle,
      market.marketTitle,
      market.outcomeLabel,
      canonical?.subject ?? "",
      canonical?.matchup ?? "",
      canonical?.family ? marketFamilyLabel(canonical.family) : "",
      canonical?.statistic ?? "",
      canonical?.threshold ?? "",
      canonical?.direction ?? "",
      canonical?.subject ? teamSearchText(canonical.subject) : "",
      ...matchupTeams.map(teamSearchText),
    ].join(" "),
  );
}

export function marketMatchesSearchIntent(
  market: MarketOpportunity,
  intent: MarketSearchIntent,
  teamRosterNames: Set<string> | null = null,
) {
  if (!intent.normalized) return true;
  const canonical = market.canonical;
  if (!canonical) return false;

  if (
    intent.families.length &&
    !intent.families.includes(canonical.family)
  ) {
    return false;
  }

  if (intent.teams.length >= 2) {
    const matchup = canonical.matchup
      ?.split("-")
      .filter(Boolean)
      .map((team) => (team === "WSH" ? "WAS" : team))
      .toSorted()
      .join("-");
    const requested = intent.teams
      .slice(0, 2)
      .map((team) => team.code)
      .toSorted()
      .join("-");
    if (!matchup || matchup !== requested) return false;
  } else if (intent.teams.length === 1) {
    const team = intent.teams[0]!;
    if (canonical.family === "moneyline") {
      if (canonical.subject !== team.code) return false;
    } else if (teamRosterNames) {
      const subject = normalizePlayerIdentity(canonical.subject);
      if (!teamRosterNames.has(subject)) return false;
    } else {
      const matchupTeams = canonical.matchup?.split("-") ?? [];
      if (!matchupTeams.includes(team.code)) return false;
    }
  }

  if (
    intent.direction &&
    userFacingDirection(market) !== intent.direction
  ) {
    return false;
  }

  if (intent.threshold !== null) {
    if (canonical.threshold === null) return false;
    if (Math.abs(canonical.threshold - intent.threshold) > 0.51) return false;
  }

  const haystack = marketSearchText(market);
  return intent.terms.every((term) => tokenMatches(term, haystack));
}
