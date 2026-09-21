import "server-only";

import { z } from "zod";
import { fetchValidated } from "@/lib/providers/http";

const statValueSchema = z.union([z.string(), z.number()]);

const athleteStatSchema = z
  .object({
    athlete: z
      .object({
        fullName: z.string().optional(),
        displayName: z.string().optional(),
        shortName: z.string().optional(),
      })
      .passthrough(),
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

const summarySchema = z
  .object({
    boxscore: z
      .object({
        players: z
          .array(
            z
              .object({
                statistics: z.array(statGroupSchema).default([]),
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
  const name = normalizeColumn((group.name ?? "") + " " + (group.displayName ?? ""));
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

      const row = group.athletes.find((entry) => {
        const athlete = entry.athlete;
        const name =
          athlete.fullName ?? athlete.displayName ?? athlete.shortName ?? "";
        return samePlayer(name, subject);
      });
      if (!row) continue;

      const value = numericStat(row.stats[index]);
      if (value !== null) return value;
    }
  }
  return null;
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

async function loadSummary(gameId: string) {
  const cached = summaryCache.get(gameId);
  if (cached && Date.now() - cached.storedAt < SUMMARY_TTL_MS) {
    return cached.payload;
  }

  const existing = summaryInflight.get(gameId);
  if (existing) return existing;

  const promise = fetchValidated(
    "ESPN box score",
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + gameId,
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

export async function getLivePlayerStat(
  gameId: string,
  subject: string,
  statistic: string,
) {
  try {
    const payload = await loadSummary(gameId);
    return extractLivePlayerStat(payload, subject, statistic);
  } catch (error) {
    console.error(
      "Live ESPN player stat unavailable for " + subject + " " + statistic,
      error,
    );
    return null;
  }
}
