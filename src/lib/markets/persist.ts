import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketEvents,
  marketListings,
  marketPriceSnapshots,
  modelVersions,
  normalizedMarkets,
  predictions,
  sourceHealth,
  sourceProjections,
} from "@/db/schema";
import { ensureSourceLearningSchema } from "@/lib/model/source-learning";
import { getWeeklyProjectionStatSnapshots } from "@/lib/model/external-projections";
import { normalizeLearningPlayer } from "@/lib/model/source-weighting";
import type { MarketsPayload } from "./service";

function stableId(prefix: string, value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${prefix}_${hex.slice(0, 24)}`;
}

async function forEachChunk<T>(
  rows: T[],
  size: number,
  worker: (chunk: T[]) => Promise<void>,
) {
  for (let index = 0; index < rows.length; index += size) {
    await worker(rows.slice(index, index + size));
  }
}

const MODEL_ID = "model_hybrid_consensus_learning_v6";
const WRITE_CHUNK_SIZE = 50;
const PROJECTION_TOUCH_CHUNK_SIZE = 400;
const RECENT_ROW_LIMIT = 10_000;

export async function persistMarkets(payload: MarketsPayload) {
  const db = getDb();
  const now = new Date();
  let listingsStored = 0;
  let snapshotsStored = 0;
  let predictionsStored = 0;
  let sourceProjectionsStored = 0;

  const startMemory = process.memoryUsage();
  console.info(
    "[market-memory]",
    JSON.stringify({
      stage: "persist-start",
      heapUsedMb: Math.round(startMemory.heapUsed / 1024 / 1024),
      rssMb: Math.round(startMemory.rss / 1024 / 1024),
      opportunities: payload.opportunities.length,
    }),
  );

  // Keep persistence reads narrow. Pulling the JSON features column for every
  // recent prediction was forcing libSQL to parse a large amount of JSON while
  // the full market model was already resident in memory.
  const recentPredictions = await db
    .select({
      listingId: predictions.listingId,
      predictedProbabilityBps: predictions.predictedProbabilityBps,
      executablePriceBps: predictions.executablePriceBps,
      predictedAt: predictions.predictedAt,
    })
    .from(predictions)
    .where(
      gte(
        predictions.predictedAt,
        new Date(now.getTime() - 2 * 60 * 60_000),
      ),
    )
    .orderBy(desc(predictions.predictedAt))
    .limit(RECENT_ROW_LIMIT);

  const latestPredictionByListing = new Map<
    string,
    (typeof recentPredictions)[number]
  >();
  for (const prediction of recentPredictions) {
    if (!latestPredictionByListing.has(prediction.listingId)) {
      latestPredictionByListing.set(prediction.listingId, prediction);
    }
  }

  // Read the latest five-minute snapshot window once instead of issuing one
  // SELECT per market. If a listing is absent here, it is old enough to need a
  // new snapshot anyway.
  const recentSnapshots = await db
    .select({
      listingId: marketPriceSnapshots.listingId,
      yesAskBps: marketPriceSnapshots.yesAskBps,
      capturedAt: marketPriceSnapshots.capturedAt,
    })
    .from(marketPriceSnapshots)
    .where(
      gte(
        marketPriceSnapshots.capturedAt,
        new Date(now.getTime() - 5 * 60_000),
      ),
    )
    .orderBy(desc(marketPriceSnapshots.capturedAt))
    .limit(RECENT_ROW_LIMIT);

  const latestSnapshotByListing = new Map<
    string,
    (typeof recentSnapshots)[number]
  >();
  for (const snapshot of recentSnapshots) {
    if (!latestSnapshotByListing.has(snapshot.listingId)) {
      latestSnapshotByListing.set(snapshot.listingId, snapshot);
    }
  }

  await db
    .insert(modelVersions)
    .values({
      id: MODEL_ID,
      name: "Huddlemark hybrid player prop model",
      version: "hybrid-consensus-learning-v18",
      family: "player_props",
      coefficients: {
        consensusWeightEarly: 1,
        statisticalWeightAtFourGames: 0.30,
        statisticalWeightMax: 0.55,
        onlineCalibrationMinBucketSamples: 20,
        sourceLearningMinSamples: 20,
        sourceLearningMaxWeight: 0.75,
        activeProjectionSources: 8,
        moneylineInjuryScenarioCapPoints: 12,
        moneylineInjuryReliabilityPenaltyMax: 0.18,
        moneylineScoringPriorWeight: 0.5,
        moneylineRecordPriorWeight: 0.15,
        moneylineEspnPriorWeight: 0.35,
      },
      calibrationNotes:
        "Independent projection ensemble with stat-specific source weights learned from settled player outcomes, plus game/weather context. Pregame moneylines apply role-aware roster-availability scenarios, with established QB1 replacement value and offensive-usage importance separated from backup and rotational-player risk, and learn bounded future-week source weights from frozen Brier grades. ESPN remains raw and betting prices never enter model probability.",
      active: true,
    })
    .onConflictDoNothing({ target: modelVersions.id });

  const projectionSnapshots = new Map<
    string,
    {
      id: string;
      season: number;
      week: number;
      playerName: string;
      playerKey: string;
      statistic: string;
      source: string;
      projectedValue: number;
      capturedAt: Date;
      latestProjectedValue: number;
      latestCapturedAt: Date;
      observationCount: number;
    }
  >();

  for (const opportunity of payload.opportunities) {
    const components = opportunity.model.components;
    const season = components?.projectionSeason;
    const week = components?.projectionWeek;
    if (
      !opportunity.canonical ||
      opportunity.isLive ||
      !season ||
      !week ||
      !components?.projectionSources?.length
    ) {
      continue;
    }

    const playerName = opportunity.canonical.subject;
    const playerKey = normalizeLearningPlayer(playerName);
    if (!playerKey) continue;
    const statistic = opportunity.canonical.family;

    for (const point of components.projectionSources) {
      const id = stableId(
        "source_projection",
        `${season}:${week}:${playerKey}:${statistic}:${point.source}`,
      );
      projectionSnapshots.set(id, {
        id,
        season,
        week,
        playerName,
        playerKey,
        statistic,
        source: point.source,
        projectedValue: point.value,
        capturedAt: now,
        latestProjectedValue: point.value,
        latestCapturedAt: now,
        observationCount: 1,
      });
    }
  }

  const projectionWindows = new Map<string, { season: number; week: number }>();
  for (const opportunity of payload.opportunities) {
    const season = opportunity.model.components?.projectionSeason;
    const week = opportunity.model.components?.projectionWeek;
    if (!season || !week || opportunity.isLive) continue;
    projectionWindows.set(`${season}:${week}`, { season, week });
  }

  for (const { season, week } of projectionWindows.values()) {
    const sourceStatLines = await getWeeklyProjectionStatSnapshots(season, week);
    for (const point of sourceStatLines) {
      const id = stableId(
        "source_projection",
        `${season}:${week}:${point.playerKey}:${point.statistic}:${point.source}`,
      );
      projectionSnapshots.set(id, {
        id,
        season,
        week,
        playerName: point.playerName,
        playerKey: point.playerKey,
        statistic: point.statistic,
        source: point.source,
        projectedValue: point.value,
        capturedAt: now,
        latestProjectedValue: point.value,
        latestCapturedAt: now,
        observationCount: 1,
      });
    }
  }

  const projectionRows = [...projectionSnapshots.values()];
  if (projectionRows.length) {
    await ensureSourceLearningSchema();
  }

  // Compare against the compact current-week rows first. New or changed source
  // values use the normal upsert. Unchanged observations only need a cheap
  // batched timestamp/count touch, preserving source freshness without 8k+
  // individual upserts every five minutes.
  const existingProjectionById = new Map<
    string,
    { latestProjectedValue: number | null }
  >();
  for (const { season, week } of projectionWindows.values()) {
    const existing = await db
      .select({
        id: sourceProjections.id,
        latestProjectedValue: sourceProjections.latestProjectedValue,
      })
      .from(sourceProjections)
      .where(
        and(
          eq(sourceProjections.season, season),
          eq(sourceProjections.week, week),
        ),
      )
      .limit(RECENT_ROW_LIMIT);
    for (const row of existing) {
      existingProjectionById.set(row.id, {
        latestProjectedValue: row.latestProjectedValue,
      });
    }
  }

  const projectionRowsToUpsert = [];
  const unchangedProjectionIds: string[] = [];
  for (const row of projectionRows) {
    const existing = existingProjectionById.get(row.id);
    if (
      !existing ||
      existing.latestProjectedValue === null ||
      Math.abs(existing.latestProjectedValue - row.latestProjectedValue) >= 0.001
    ) {
      projectionRowsToUpsert.push(row);
    } else {
      unchangedProjectionIds.push(row.id);
    }
  }

  await forEachChunk(projectionRowsToUpsert, 100, async (chunk) => {
    await db
      .insert(sourceProjections)
      .values(chunk)
      .onConflictDoUpdate({
        target: sourceProjections.id,
        set: {
          latestProjectedValue: sql`excluded.latest_projected_value`,
          latestCapturedAt: sql`excluded.latest_captured_at`,
          observationCount: sql`${sourceProjections.observationCount} + 1`,
          updatedAt: now,
        },
      });
  });

  await forEachChunk(
    unchangedProjectionIds,
    PROJECTION_TOUCH_CHUNK_SIZE,
    async (ids) => {
      await db
        .update(sourceProjections)
        .set({
          latestCapturedAt: now,
          observationCount: sql`${sourceProjections.observationCount} + 1`,
          updatedAt: now,
        })
        .where(inArray(sourceProjections.id, ids));
    },
  );
  sourceProjectionsStored = projectionRows.length;

  for (const provider of payload.providers) {
    await db
      .insert(sourceHealth)
      .values({
        provider: provider.provider,
        status: provider.error ? "unavailable" : "healthy",
        lastSuccessAt: provider.error ? null : now,
        lastFailureAt: provider.error ? now : null,
        lastError: provider.error,
      })
      .onConflictDoUpdate({
        target: sourceHealth.provider,
        set: {
          status: provider.error ? "unavailable" : "healthy",
          ...(provider.error
            ? { lastFailureAt: now, lastError: provider.error }
            : { lastSuccessAt: now, lastError: null }),
        },
      });
  }

  for (let start = 0; start < payload.opportunities.length; start += WRITE_CHUNK_SIZE) {
    const opportunities = payload.opportunities.slice(
      start,
      start + WRITE_CHUNK_SIZE,
    );

    const eventRows = new Map<
      string,
      {
        id: string;
        title: string;
        startsAt: Date | null;
        status: string;
      }
    >();
    const normalizedRows = [];
    const listingRows = [];
    const prepared = [];

    for (const opportunity of opportunities) {
      const eventId = stableId(
        "event",
        `${opportunity.eventTitle}:${opportunity.canonical?.settlementDate ?? opportunity.closesAt ?? "unknown"}`,
      );
      eventRows.set(eventId, {
        id: eventId,
        title: opportunity.eventTitle,
        startsAt: opportunity.closesAt ? new Date(opportunity.closesAt) : null,
        status: opportunity.status,
      });

      const normalizedId = opportunity.canonical
        ? stableId("market", opportunity.canonical.key)
        : null;
      if (opportunity.canonical && normalizedId) {
        normalizedRows.push({
          id: normalizedId,
          eventId,
          family: opportunity.canonical.family,
          statistic: opportunity.canonical.statistic,
          direction: opportunity.canonical.direction,
          threshold: opportunity.canonical.threshold,
          outcomeLabel: opportunity.outcomeLabel,
          resolutionKey: opportunity.canonical.key,
          settlementAt: opportunity.closesAt
            ? new Date(opportunity.closesAt)
            : null,
        });
      }

      const listingId = stableId(
        "listing",
        `${opportunity.platform}:${opportunity.platformMarketId}:${opportunity.platformOutcomeId ?? "yes"}`,
      );
      listingRows.push({
        id: listingId,
        normalizedMarketId: normalizedId,
        platform: opportunity.platform,
        platformMarketId: opportunity.platformMarketId,
        platformOutcomeId: opportunity.platformOutcomeId,
        eventTitle: opportunity.eventTitle,
        marketTitle: opportunity.marketTitle,
        outcomeLabel: opportunity.outcomeLabel,
        resolutionRules: opportunity.resolutionRules,
        status: opportunity.status,
        isLive: opportunity.isLive,
        yesBidBps: opportunity.yesBidBps,
        yesAskBps: opportunity.yesAskBps,
        noBidBps: opportunity.noBidBps,
        noAskBps: opportunity.noAskBps,
        lastPriceBps: opportunity.lastPriceBps,
        liquidityCents: opportunity.liquidityCents,
        volumeCents: opportunity.volumeCents,
        closesAt: opportunity.closesAt
          ? new Date(opportunity.closesAt)
          : null,
        sourceUpdatedAt: new Date(opportunity.updatedAt),
        fetchedAt: now,
      });
      prepared.push({ opportunity, normalizedId, listingId });
    }

    const events = [...eventRows.values()];
    if (events.length) {
      await db
        .insert(marketEvents)
        .values(events)
        .onConflictDoUpdate({
          target: marketEvents.id,
          set: {
            title: sql`excluded.title`,
            startsAt: sql`excluded.starts_at`,
            status: sql`excluded.status`,
            updatedAt: now,
          },
        });
    }

    if (normalizedRows.length) {
      await db
        .insert(normalizedMarkets)
        .values(normalizedRows)
        .onConflictDoUpdate({
          target: normalizedMarkets.id,
          set: {
            eventId: sql`excluded.event_id`,
            family: sql`excluded.family`,
            statistic: sql`excluded.statistic`,
            direction: sql`excluded.direction`,
            threshold: sql`excluded.threshold`,
            outcomeLabel: sql`excluded.outcome_label`,
            settlementAt: sql`excluded.settlement_at`,
            updatedAt: now,
          },
        });
    }

    if (listingRows.length) {
      await db
        .insert(marketListings)
        .values(listingRows)
        .onConflictDoUpdate({
          target: marketListings.id,
          set: {
            normalizedMarketId: sql`excluded.normalized_market_id`,
            eventTitle: sql`excluded.event_title`,
            marketTitle: sql`excluded.market_title`,
            outcomeLabel: sql`excluded.outcome_label`,
            resolutionRules: sql`excluded.resolution_rules`,
            status: sql`excluded.status`,
            isLive: sql`excluded.is_live`,
            yesBidBps: sql`excluded.yes_bid_bps`,
            yesAskBps: sql`excluded.yes_ask_bps`,
            noBidBps: sql`excluded.no_bid_bps`,
            noAskBps: sql`excluded.no_ask_bps`,
            lastPriceBps: sql`excluded.last_price_bps`,
            liquidityCents: sql`excluded.liquidity_cents`,
            volumeCents: sql`excluded.volume_cents`,
            closesAt: sql`excluded.closes_at`,
            sourceUpdatedAt: sql`excluded.source_updated_at`,
            fetchedAt: sql`excluded.fetched_at`,
            updatedAt: now,
          },
        });
      listingsStored += listingRows.length;
    }

    const snapshotRows = [];
    const predictionRows = [];

    for (const { opportunity, normalizedId, listingId } of prepared) {
      const latestSnapshot = latestSnapshotByListing.get(listingId);
      const snapshotChanged =
        !latestSnapshot ||
        Math.abs(
          (latestSnapshot.yesAskBps ?? 0) - (opportunity.yesAskBps ?? 0),
        ) >= 100 ||
        now.getTime() - latestSnapshot.capturedAt.getTime() >= 5 * 60_000;

      if (snapshotChanged) {
        snapshotRows.push({
          id: crypto.randomUUID(),
          listingId,
          capturedAt: now,
          yesBidBps: opportunity.yesBidBps,
          yesAskBps: opportunity.yesAskBps,
          noBidBps: opportunity.noBidBps,
          noAskBps: opportunity.noAskBps,
          liquidityCents: opportunity.liquidityCents,
          volumeCents: opportunity.volumeCents,
        });
        latestSnapshotByListing.set(listingId, {
          listingId,
          yesAskBps: opportunity.yesAskBps,
          capturedAt: now,
        });
      }

      if (
        !normalizedId ||
        opportunity.model.probabilityBps === null ||
        opportunity.executablePriceBps === null ||
        opportunity.edgeBps === null
      ) {
        continue;
      }

      const latestPrediction = latestPredictionByListing.get(listingId);
      const recommendedProbabilityBps =
        opportunity.recommendedProbabilityBps ??
        opportunity.model.probabilityBps;
      const predictionChanged =
        !latestPrediction ||
        Math.abs(
          latestPrediction.predictedProbabilityBps -
            recommendedProbabilityBps,
        ) >= 100 ||
        Math.abs(
          latestPrediction.executablePriceBps -
            opportunity.executablePriceBps,
        ) >= 100 ||
        now.getTime() - latestPrediction.predictedAt.getTime() >=
          2 * 60 * 60_000;

      if (!predictionChanged) continue;

      predictionRows.push({
        id: crypto.randomUUID(),
        normalizedMarketId: normalizedId,
        listingId,
        modelVersionId: MODEL_ID,
        predictedProbabilityBps: recommendedProbabilityBps,
        executablePriceBps: opportunity.executablePriceBps,
        edgeBps: opportunity.edgeBps,
        reliabilityBps: opportunity.model.reliabilityBps,
        opportunityScore: opportunity.opportunityScore ?? 0,
        sampleSize: opportunity.model.evidence.sampleSize,
        features: {
          threshold: opportunity.canonical?.threshold ?? null,
          recommendedSide: opportunity.recommendedSide,
          recommendedProbabilityBps,
          modelYesProbabilityBps: opportunity.model.probabilityBps,
          probabilityPerspective: "recommended_side",
          lynervaScore: opportunity.lynervaScore ?? null,
          projectionSeason:
            opportunity.model.components?.projectionSeason ?? null,
          projectionWeek:
            opportunity.model.components?.projectionWeek ?? null,
          matchup: opportunity.canonical?.matchup ?? null,
          subject: opportunity.canonical?.subject ?? null,
          historicalSampleSize: opportunity.model.evidence.sampleSize,
          live: opportunity.isLive,
          consensusProjection:
            opportunity.model.components?.consensusProjection ?? null,
          consensusProbabilityBps:
            opportunity.model.components?.consensusProbabilityBps ?? null,
          statisticalProbabilityBps:
            opportunity.model.components?.statisticalProbabilityBps ?? null,
          contextAdjustmentBps:
            opportunity.model.components?.contextAdjustmentBps ?? 0,
          projectionSourceCount:
            opportunity.model.components?.projectionSourceCount ?? 0,
          gameProjectionSourcesJson:
            opportunity.model.components?.gameProjectionSources?.length
              ? JSON.stringify(
                  opportunity.model.components.gameProjectionSources,
                )
              : null,
          gameProjectionSourceWeightsJson:
            opportunity.model.components?.gameProjectionSourceWeights?.length
              ? JSON.stringify(
                  opportunity.model.components.gameProjectionSourceWeights,
                )
              : null,
          moneylineWeightEffectiveWeek:
            opportunity.model.components?.moneylineWeightEffectiveWeek ??
            null,
          moneylineBaselineProbabilityBps:
            opportunity.model.components?.moneylineBaselineProbabilityBps ??
            null,
          moneylineInjuryAdjustedProbabilityBps:
            opportunity.model.components
              ?.moneylineInjuryAdjustedProbabilityBps ?? null,
          moneylineInjuryReliabilityPenaltyBps:
            opportunity.model.components
              ?.moneylineInjuryReliabilityPenaltyBps ?? null,
          moneylineInjuryScenariosJson:
            opportunity.model.components?.moneylineInjuryScenarios?.length
              ? JSON.stringify(
                  opportunity.model.components.moneylineInjuryScenarios,
                )
              : null,
          learnedCalibrationSample:
            opportunity.model.components?.learnedCalibrationSample ?? 0,
          learnedCalibrationActive:
            opportunity.model.components?.learnedCalibrationActive ?? false,
        },
        explanation: opportunity.model.factors,
        predictedAt: now,
      });

      latestPredictionByListing.set(listingId, {
        listingId,
        predictedProbabilityBps: recommendedProbabilityBps,
        executablePriceBps: opportunity.executablePriceBps,
        predictedAt: now,
      });
    }

    if (snapshotRows.length) {
      await db.insert(marketPriceSnapshots).values(snapshotRows);
      snapshotsStored += snapshotRows.length;
    }

    if (predictionRows.length) {
      await db.insert(predictions).values(predictionRows);
      predictionsStored += predictionRows.length;
    }
  }

  return {
    listingsStored,
    snapshotsStored,
    predictionsStored,
    sourceProjectionsStored,
  };
}
