import "server-only";

import { z } from "zod";
import { fetchValidated } from "@/lib/providers/http";

const statValueSchema = z.union([z.string(), z.number()]);

const athleteIdentitySchema = z
  .object({
    id: z.string().optional(),
    fullName: z.string().optional(),
    displayName: z.string().optional(),
    shortName: z.string().optional(),
  })
  .passthrough();

const teamIdentitySchema = z
  .object({
    id: z.string().optional(),
    abbreviation: z.string().optional(),
    displayName: z.string().optional(),
  })
  .passthrough();

const athleteStatSchema = z
  .object({
    athlete: athleteIdentitySchema,
    stats: z.array(statValueSchema).default([]),
  })
  .passthrough();

const statGroupSchema = z
  .object({
    name: z.string().optional(),
    displayName: z.string().optional(),
    keys: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    descriptions: z.array(z.string()).optional(),
    athletes: z.array(athleteStatSchema).default([]),
  })
  .passthrough();

const injuryItemSchema = z
  .object({
    athlete: athleteIdentitySchema,
    status: z.string().optional(),
    detail: z.string().optional(),
    type: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        abbreviation: z.string().optional(),
      })
      .passthrough()
      .optional(),
    details: z
      .object({
        type: z.string().optional(),
        detail: z.string().optional(),
        returnDate: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const injuryGroupSchema = z
  .object({
    team: teamIdentitySchema.optional(),
    injuries: z.array(injuryItemSchema).default([]),
  })
  .passthrough();

const boxscoreTeamSchema = z
  .object({
    team: teamIdentitySchema.optional(),
    statistics: z.array(statGroupSchema).default([]),
  })
  .passthrough();

const headerCompetitorSchema = z
  .object({
    team: teamIdentitySchema.optional(),
    injuries: z.array(injuryItemSchema).default([]),
  })
  .passthrough();

const summarySchema = z
  .object({
    boxscore: z
      .object({
        players: z.array(boxscoreTeamSchema).default([]),
      })
      .passthrough()
      .optional(),
    injuries: z.array(injuryGroupSchema).default([]),
    header: z
      .object({
        competitions: z
          .array(
            z
              .object({
                competitors: z.array(headerCompetitorSchema).default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type EspnSummary = z.infer<typeof summarySchema>;
type StatGroup = z.infer<typeof statGroupSchema>;
type InjuryItem = z.infer<typeof injuryItemSchema>;

export interface LivePlayerState {
  value: number;
  team: string | null;
  injuryStatus: string | null;
  injuryDetail: string | null;
}

export interface EspnPlayerGameStats {
  playerName: string;
  team: string | null;
  passingYards: number | null;
  passingTouchdowns: number | null;
  passingInterceptions: number | null;
  rushingYards: number | null;
  rushingTouchdowns: number | null;
  receivingYards: number | null;
  receptions: number | null;
  receivingTouchdowns: number | null;
}

const summaryCache = new Map<
  string,
  { payload: EspnSummary; storedAt: number }
>();
const summaryInflight = new Map<string, Promise<EspnSummary>>();
const SUMMARY_TTL_MS = 8_000;

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeColumn(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function athleteName(athlete: z.infer<typeof athleteIdentitySchema>) {
  return athlete.fullName ?? athlete.displayName ?? athlete.shortName ?? "";
}

function samePlayer(candidate: string, subject: string) {
  const first = normalizePerson(candidate);
  const second = normalizePerson(subject);
  if (!first || !second) return false;
  return (
    first === second ||
    (first.length >= 5 && second.includes(first)) ||
    (second.length >= 5 && first.includes(second))
  );
}

function groupMatches(group: StatGroup, names: string[]) {
  const name = normalizeColumn(
    (group.name ?? "") + " " + (group.displayName ?? ""),
  );
  return names.some((candidate) => name.includes(normalizeColumn(candidate)));
}

function numericStat(value: string | number | undefined) {
  if (value === undefined) return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function findColumnIndex(group: StatGroup, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeColumn);
  for (const columns of [group.keys, group.labels, group.descriptions]) {
    if (!columns?.length) continue;
    const index = columns.findIndex((column) => {
      const normalized = normalizeColumn(column);
      return normalizedAliases.some(
        (alias) =>
          normalized === alias ||
          (alias.length >= 4 && normalized.includes(alias)) ||
          (normalized.length >= 4 && alias.includes(normalized)),
      );
    });
    if (index >= 0) return index;
  }
  return -1;
}

function groupValue(
  payload: EspnSummary,
  subject: string,
  groupNames: string[],
  columnAliases: string[],
) {
  for (const team of payload.boxscore?.players ?? []) {
    for (const group of team.statistics) {
      if (!groupMatches(group, groupNames)) continue;
      const index = findColumnIndex(group, columnAliases);
      if (index < 0) continue;

      const row = group.athletes.find((entry) =>
        samePlayer(athleteName(entry.athlete), subject),
      );
      if (!row) continue;

      const value = numericStat(row.stats[index]);
      if (value !== null) return value;
    }
  }
  return null;
}

function playerTeam(payload: EspnSummary, subject: string) {
  for (const team of payload.boxscore?.players ?? []) {
    const found = team.statistics.some((group) =>
      group.athletes.some((entry) =>
        samePlayer(athleteName(entry.athlete), subject),
      ),
    );
    if (found) return team.team?.abbreviation ?? null;
  }
  return null;
}

function statusLikeInjuryValue(value: string | null | undefined) {
  if (!value) return false;
  return /^(?:q|d|o|p|questionable|doubtful|out|probable|active|inactive|injury_status_[a-z_]+)$/i.test(
    value.trim(),
  );
}

function cleanInjuryDetail(injury: InjuryItem) {
  const status = injury.status ?? injury.type?.description ?? "";
  const bodyPart =
    injury.details?.type && !statusLikeInjuryValue(injury.details.type)
      ? injury.details.type
      : null;
  const candidates = [injury.details?.detail, injury.detail]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !statusLikeInjuryValue(value))
    .filter((value) => value.toLowerCase() !== status.toLowerCase())
    .filter(
      (value) =>
        !bodyPart || value.toLowerCase() !== bodyPart.toLowerCase(),
    );

  return [...new Set(candidates)].join(" · ") || null;
}

function findPlayerInjury(payload: EspnSummary, subject: string) {
  const candidates: InjuryItem[] = [];

  for (const group of payload.injuries) {
    candidates.push(...group.injuries);
  }
  for (const competition of payload.header?.competitions ?? []) {
    for (const competitor of competition.competitors) {
      candidates.push(...competitor.injuries);
    }
  }

  const injury = candidates.find((item) =>
    samePlayer(athleteName(item.athlete), subject),
  );
  if (!injury) {
    return {
      status: null as string | null,
      detail: null as string | null,
      bodyPart: null as string | null,
      returnDate: null as string | null,
    };
  }

  const status = injury.status ?? injury.type?.description ?? null;
  const bodyPartCandidates = [
    injury.details?.type,
    injury.type?.name,
    injury.type?.description,
  ];
  const bodyPart =
    bodyPartCandidates.find(
      (value) => value && !statusLikeInjuryValue(value),
    ) ?? null;

  return {
    status,
    detail: cleanInjuryDetail(injury),
    bodyPart,
    returnDate: injury.details?.returnDate ?? null,
  };
}

export function extractLivePlayerStat(
  payload: EspnSummary,
  subject: string,
  statistic: string,
) {
  switch (statistic) {
    case "passing_yards":
      return groupValue(payload, subject, ["passing"], [
        "passingYards",
        "yards",
        "yds",
      ]);
    case "passing_touchdowns":
      return groupValue(payload, subject, ["passing"], [
        "passingTouchdowns",
        "touchdowns",
        "td",
      ]);
    case "passing_interceptions":
      return groupValue(payload, subject, ["passing"], [
        "interceptions",
        "int",
      ]);
    case "rushing_yards":
      return groupValue(payload, subject, ["rushing"], [
        "rushingYards",
        "yards",
        "yds",
      ]);
    case "receiving_yards":
      return groupValue(payload, subject, ["receiving"], [
        "receivingYards",
        "yards",
        "yds",
      ]);
    case "receptions":
      return groupValue(payload, subject, ["receiving"], [
        "receptions",
        "rec",
      ]);
    case "longest_reception":
      return groupValue(payload, subject, ["receiving"], [
        "longReception",
        "longestReception",
        "long",
      ]);
    case "touchdowns": {
      const rushing = groupValue(payload, subject, ["rushing"], [
        "rushingTouchdowns",
        "touchdowns",
        "td",
      ]);
      const receiving = groupValue(payload, subject, ["receiving"], [
        "receivingTouchdowns",
        "touchdowns",
        "td",
      ]);
      if (rushing === null && receiving === null) return null;
      return (rushing ?? 0) + (receiving ?? 0);
    }
    default:
      return null;
  }
}

export function extractEspnPlayerGameStats(
  payload: EspnSummary,
): EspnPlayerGameStats[] {
  const players = new Map<string, { name: string; team: string | null }>();

  for (const team of payload.boxscore?.players ?? []) {
    for (const group of team.statistics) {
      for (const entry of group.athletes) {
        const name = athleteName(entry.athlete);
        const key = normalizePerson(name);
        if (!key) continue;
        players.set(key, {
          name,
          team: team.team?.abbreviation ?? null,
        });
      }
    }
  }

  return [...players.values()].map(({ name, team }) => ({
    playerName: name,
    team,
    passingYards: groupValue(payload, name, ["passing"], [
      "passingYards",
      "yards",
      "yds",
    ]),
    passingTouchdowns: groupValue(payload, name, ["passing"], [
      "passingTouchdowns",
      "touchdowns",
      "td",
    ]),
    passingInterceptions: groupValue(payload, name, ["passing"], [
      "interceptions",
      "int",
    ]),
    rushingYards: groupValue(payload, name, ["rushing"], [
      "rushingYards",
      "yards",
      "yds",
    ]),
    rushingTouchdowns: groupValue(payload, name, ["rushing"], [
      "rushingTouchdowns",
      "touchdowns",
      "td",
    ]),
    receivingYards: groupValue(payload, name, ["receiving"], [
      "receivingYards",
      "yards",
      "yds",
    ]),
    receptions: groupValue(payload, name, ["receiving"], [
      "receptions",
      "rec",
    ]),
    receivingTouchdowns: groupValue(payload, name, ["receiving"], [
      "receivingTouchdowns",
      "touchdowns",
      "td",
    ]),
  }));
}

async function loadSummary(gameId: string) {
  const cached = summaryCache.get(gameId);
  if (cached && Date.now() - cached.storedAt < SUMMARY_TTL_MS) {
    return cached.payload;
  }

  const existing = summaryInflight.get(gameId);
  if (existing) return existing;

  const promise = fetchValidated(
    "ESPN box score",
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" +
      gameId,
    summarySchema,
    { cache: "no-store" },
  )
    .then((payload) => {
      summaryCache.set(gameId, { payload, storedAt: Date.now() });
      return payload;
    })
    .finally(() => {
      summaryInflight.delete(gameId);
    });

  summaryInflight.set(gameId, promise);
  return promise;
}

export async function getEspnPlayerInjuryState(
  gameId: string,
  subject: string,
) {
  try {
    const injury = findPlayerInjury(await loadSummary(gameId), subject);
    if (!injury.status && !injury.detail && !injury.bodyPart) return null;
    return injury;
  } catch (error) {
    console.error("ESPN injury state unavailable for " + subject, error);
    return null;
  }
}

export async function getLivePlayerState(
  gameId: string,
  subject: string,
  statistic: string,
): Promise<LivePlayerState | null> {
  try {
    const payload = await loadSummary(gameId);
    const value = extractLivePlayerStat(payload, subject, statistic);
    if (value === null) return null;
    const injury = findPlayerInjury(payload, subject);
    return {
      value,
      team: playerTeam(payload, subject),
      injuryStatus: injury.status,
      injuryDetail: injury.detail,
    };
  } catch (error) {
    console.error(
      "Live ESPN player state unavailable for " + subject + " " + statistic,
      error,
    );
    return null;
  }
}

export async function getLivePlayerStat(
  gameId: string,
  subject: string,
  statistic: string,
) {
  return (await getLivePlayerState(gameId, subject, statistic))?.value ?? null;
}

export async function getEspnPlayerGameStats(gameId: string) {
  try {
    return extractEspnPlayerGameStats(await loadSummary(gameId));
  } catch (error) {
    console.error("ESPN final player stats unavailable for " + gameId, error);
    return [] as EspnPlayerGameStats[];
  }
}
