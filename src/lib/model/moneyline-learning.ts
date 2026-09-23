import "server-only";

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  moneylineSourceWeightHistory,
  nflGames,
  normalizedMarkets,
  predictions,
} from "@/db/schema";
import {
  calculateMoneylineWeights,
  MONEYLINE_SOURCES,
  priorMoneylineWeights,
  type LearnedMoneylineWeight,
  type MoneylineSource,
  type MoneylineWeightSample,
} from "./moneyline-weighting";

export interface MoneylineWeightSet {
  effectiveWeek: number | null;
  rows: LearnedMoneylineWeight[];
}

const CACHE_MS = 15 * 60_000;
const cache = new Map<
  string,
  { expiresAt: number; promise: Promise<MoneylineWeightSet> }
>();
let schemaPromise: Promise<void> | null = null;

function canonicalTeam(value: string) {
  const team = value.trim().toUpperCase();
  if (team === "WSH") return "WAS";
  if (team === "JAC") return "JAX";
  if (team === "LA") return "LAR";
  return team;
}

function matchupKey(value: string) {
  return value
    .split(/[^A-Za-z]+/)
    .map(canonicalTeam)
    .filter(Boolean)
    .toSorted()
    .join("-");
}

function parseSources(value: unknown) {
  if (typeof value !== "string" || !value) {
    return [] as Array<{ source: MoneylineSource; probabilityBps: number }>;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((point) => {
      if (
        !point ||
        typeof point !== "object" ||
        !("source" in point) ||
        !("probabilityBps" in point) ||
        typeof point.source !== "string" ||
        !MONEYLINE_SOURCES.includes(point.source as MoneylineSource) ||
        typeof point.probabilityBps !== "number" ||
        !Number.isFinite(point.probabilityBps)
      ) {
        return [];
      }
      return [{
        source: point.source as MoneylineSource,
        probabilityBps: Math.max(1, Math.min(9_999, point.probabilityBps)),
      }];
    });
  } catch {
    return [];
  }
}

export function ensureMoneylineLearningSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const db = getDb();
    await db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS moneyline_source_weight_history (
        id text PRIMARY KEY NOT NULL,
        season integer NOT NULL,
        effective_week integer NOT NULL,
        source text NOT NULL,
        weight real NOT NULL,
        prior_weight real NOT NULL,
        sample_size integer NOT NULL,
        brier_score real,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      )
    `));
    await db.run(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS moneyline_source_weight_unique
      ON moneyline_source_weight_history (season, effective_week, source)
    `));
    await db.run(sql.raw(`
      CREATE INDEX IF NOT EXISTS moneyline_source_weight_lookup_idx
      ON moneyline_source_weight_history (season, effective_week)
    `));
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function stableId(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `moneyline_weight_${hex.slice(0, 24)}`;
}

export function getMoneylineSourceWeights(
  season: number,
  week: number,
): Promise<MoneylineWeightSet> {
  const key = `${season}:${week}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async (): Promise<MoneylineWeightSet> => {
    try {
      await ensureMoneylineLearningSchema();
      const db = getDb();
      const rows = await db
        .select({
          effectiveWeek: moneylineSourceWeightHistory.effectiveWeek,
          source: moneylineSourceWeightHistory.source,
          weight: moneylineSourceWeightHistory.weight,
          priorWeight: moneylineSourceWeightHistory.priorWeight,
          sampleSize: moneylineSourceWeightHistory.sampleSize,
          brierScore: moneylineSourceWeightHistory.brierScore,
        })
        .from(moneylineSourceWeightHistory)
        .where(
          and(
            eq(moneylineSourceWeightHistory.season, season),
            lte(moneylineSourceWeightHistory.effectiveWeek, week),
          ),
        )
        .orderBy(desc(moneylineSourceWeightHistory.effectiveWeek))
        .limit(MONEYLINE_SOURCES.length * 4);
      const effectiveWeek = rows[0]?.effectiveWeek;
      if (effectiveWeek === undefined) {
        return { effectiveWeek: null, rows: priorMoneylineWeights() };
      }
      const selected = rows.filter((row) => row.effectiveWeek === effectiveWeek);
      const bySource = new Map(selected.map((row) => [row.source, row]));
      const priors = priorMoneylineWeights();
      return {
        effectiveWeek,
        rows: priors.map((prior) => {
          const row = bySource.get(prior.source);
          return row
            ? {
                source: prior.source,
                weight: row.weight,
                priorWeight: row.priorWeight,
                sampleSize: row.sampleSize,
                brierScore: row.brierScore,
              }
            : prior;
        }),
      };
    } catch (error) {
      console.error("Moneyline source weights unavailable", error);
      return { effectiveWeek: null, rows: priorMoneylineWeights() };
    }
  })();
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

export async function runMoneylineSourceLearning(season: number) {
  try {
    await ensureMoneylineLearningSchema();
    const db = getDb();
    const [predictionRows, gameRows] = await Promise.all([
      db
        .select({
          features: predictions.features,
          predictedAt: predictions.predictedAt,
        })
        .from(predictions)
        .innerJoin(
          normalizedMarkets,
          eq(normalizedMarkets.id, predictions.normalizedMarketId),
        )
        .where(eq(normalizedMarkets.family, "moneyline"))
        .orderBy(desc(predictions.predictedAt)),
      db
        .select({
          week: nflGames.week,
          kickoffAt: nflGames.kickoffAt,
          homeTeam: nflGames.homeTeam,
          awayTeam: nflGames.awayTeam,
          homeScore: nflGames.homeScore,
          awayScore: nflGames.awayScore,
          status: nflGames.status,
        })
        .from(nflGames)
        .where(
          and(
            eq(nflGames.season, season),
            eq(nflGames.seasonType, "REG"),
          ),
        ),
    ]);

    const finals = new Map<
      string,
      { week: number; kickoffAt: Date; winner: string | null }
    >();
    for (const game of gameRows) {
      if (
        game.week === null ||
        game.homeScore === null ||
        game.awayScore === null ||
        !/final/i.test(game.status)
      ) {
        continue;
      }
      const key = `${game.week}:${matchupKey(`${game.homeTeam}-${game.awayTeam}`)}`;
      finals.set(key, {
        week: game.week,
        kickoffAt: game.kickoffAt,
        winner:
          game.homeScore === game.awayScore
            ? null
            : canonicalTeam(
                game.homeScore > game.awayScore
                  ? game.homeTeam
                  : game.awayTeam,
              ),
      });
    }

    const latest = new Map<string, MoneylineWeightSample>();
    for (const row of predictionRows) {
      const features = row.features;
      if (
        features.live === true ||
        features.projectionSeason !== season ||
        typeof features.projectionWeek !== "number" ||
        typeof features.matchup !== "string" ||
        typeof features.subject !== "string"
      ) {
        continue;
      }
      const week = features.projectionWeek;
      const matchup = matchupKey(features.matchup);
      const final = finals.get(`${week}:${matchup}`);
      if (!final || row.predictedAt >= final.kickoffAt) continue;
      const subject = canonicalTeam(features.subject);
      const outcome: 0 | 0.5 | 1 =
        final.winner === null ? 0.5 : final.winner === subject ? 1 : 0;

      for (const point of parseSources(features.gameProjectionSourcesJson)) {
        const key = `${week}:${matchup}:${point.source}`;
        if (latest.has(key)) continue;
        latest.set(key, {
          source: point.source,
          probability: point.probabilityBps / 10_000,
          outcome,
          week,
        });
      }
    }

    const samples = [...latest.values()];
    if (!samples.length) {
      return { effectiveWeek: null, weightsStored: 0, samples: 0 };
    }
    const latestWeek = Math.max(...samples.map((sample) => sample.week));
    const effectiveWeek = latestWeek + 1;
    const weights = calculateMoneylineWeights(samples, effectiveWeek);

    for (const row of weights) {
      const id = await stableId(`${season}:${effectiveWeek}:${row.source}`);
      await db
        .insert(moneylineSourceWeightHistory)
        .values({
          id,
          season,
          effectiveWeek,
          source: row.source,
          weight: row.weight,
          priorWeight: row.priorWeight,
          sampleSize: row.sampleSize,
          brierScore: row.brierScore,
        })
        .onConflictDoUpdate({
          target: moneylineSourceWeightHistory.id,
          set: {
            weight: row.weight,
            priorWeight: row.priorWeight,
            sampleSize: row.sampleSize,
            brierScore: row.brierScore,
            updatedAt: new Date(),
          },
        });
    }
    cache.clear();
    return {
      effectiveWeek,
      weightsStored: weights.length,
      samples: samples.length,
    };
  } catch (error) {
    console.error("Moneyline source learning failed", error);
    return {
      effectiveWeek: null,
      weightsStored: 0,
      samples: 0,
      error: error instanceof Error ? error.message : "Unknown learning error",
    };
  }
}
