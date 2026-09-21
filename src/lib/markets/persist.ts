import "server-only";

import { desc, eq, gte, sql } from "drizzle-orm";
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

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex.slice(0, 24)}`;
}

const MODEL_ID = "model_hybrid_consensus_learning_v3";

export async function persistMarkets(payload: MarketsPayload) {
  const db = getDb();
  const now = new Date();
  let listingsStored = 0;
  let snapshotsStored = 0;
  let predictionsStored = 0;
  let sourceProjectionsStored = 0;

  // One bounded read replaces a per-market lookup. Anything older than two
  // hours is due for a fresh frozen prediction anyway.
  const recentPredictions = await db
    .select({
      listingId: predictions.listingId,
      predictedProbabilityBps: predictions.predictedProbabilityBps,
      executablePriceBps: predictions.executablePriceBps,
      features: predictions.features,
      predictedAt: predictions.predictedAt,
    })
    .from(predictions)
    .where(gte(predictions.predictedAt, new Date(now.getTime() - 2 * 60 * 60_000)))
    .orderBy(desc(predictions.predictedAt));
  const latestPredictionByListing = new Map<
    string,
    (typeof recentPredictions)[number]
  >();
  for (const prediction of recentPredictions) {
    if (!latestPredictionByListing.has(prediction.listingId)) {
      latestPredictionByListing.set(prediction.listingId, prediction);
    }
  }

  await db
    .insert(modelVersions)
    .values({
      id: MODEL_ID,
      name: "Huddlemark hybrid player prop model",
      version: "hybrid-consensus-learning-v3",
      family: "player_props",
      coefficients: {
        consensusWeightEarly: 1,
        statisticalWeightAtFourGames: 0.30,
        statisticalWeightMax: 0.55,
        onlineCalibrationMinBucketSamples: 20,
        sourceLearningMinSamples: 20,
        sourceLearningMaxWeight: 0.75,
      },
      calibrationNotes:
        "Independent projection ensemble with stat-specific source weights learned from settled player outcomes, plus game/weather context. Current-season statistical history activates at four games. Settled outcomes calibrate future probabilities by prediction bucket.",
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
      const id = await stableId(
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
      const id = await stableId(
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
      });
    }
  }

  const projectionRows = [...projectionSnapshots.values()];
  if (projectionRows.length) {
    await ensureSourceLearningSchema();
  }
  for (let index = 0; index < projectionRows.length; index += 100) {
    const chunk = projectionRows.slice(index, index + 100);
    await db
      .insert(sourceProjections)
      .values(chunk)
      .onConflictDoUpdate({
        target: sourceProjections.id,
        set: {
          projectedValue: sql`excluded.projected_value`,
          capturedAt: sql`excluded.captured_at`,
          updatedAt: now,
        },
      });
    sourceProjectionsStored += chunk.length;
  }

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

  for (const opportunity of payload.opportunities) {
    const eventId = await stableId(
      "event",
      `${opportunity.eventTitle}:${opportunity.canonical?.settlementDate ?? opportunity.closesAt ?? "unknown"}`,
    );
    await db
      .insert(marketEvents)
      .values({
        id: eventId,
        title: opportunity.eventTitle,
        startsAt: opportunity.closesAt ? new Date(opportunity.closesAt) : null,
        status: opportunity.status,
      })
      .onConflictDoUpdate({
        target: marketEvents.id,
        set: { title: opportunity.eventTitle, status: opportunity.status },
      });

    const normalizedId = opportunity.canonical
      ? await stableId("market", opportunity.canonical.key)
      : null;
    if (opportunity.canonical && normalizedId) {
      await db
        .insert(normalizedMarkets)
        .values({
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
        })
        .onConflictDoUpdate({
          target: normalizedMarkets.id,
          set: {
            eventId,
            outcomeLabel: opportunity.outcomeLabel,
            settlementAt: opportunity.closesAt
              ? new Date(opportunity.closesAt)
              : null,
          },
        });
    }

    const listingId = await stableId(
      "listing",
      `${opportunity.platform}:${opportunity.platformMarketId}:${opportunity.platformOutcomeId ?? "yes"}`,
    );
    await db
      .insert(marketListings)
      .values({
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
      })
      .onConflictDoUpdate({
        target: marketListings.id,
        set: {
          normalizedMarketId: normalizedId,
          status: opportunity.status,
          isLive: opportunity.isLive,
          yesBidBps: opportunity.yesBidBps,
          yesAskBps: opportunity.yesAskBps,
          noBidBps: opportunity.noBidBps,
          noAskBps: opportunity.noAskBps,
          lastPriceBps: opportunity.lastPriceBps,
          liquidityCents: opportunity.liquidityCents,
          volumeCents: opportunity.volumeCents,
          sourceUpdatedAt: new Date(opportunity.updatedAt),
          fetchedAt: now,
        },
      });
    listingsStored += 1;

    const [latest] = await db
      .select()
      .from(marketPriceSnapshots)
      .where(eq(marketPriceSnapshots.listingId, listingId))
      .orderBy(desc(marketPriceSnapshots.capturedAt))
      .limit(1);
    const changed =
      !latest ||
      Math.abs((latest.yesAskBps ?? 0) - (opportunity.yesAskBps ?? 0)) >= 100 ||
      now.getTime() - latest.capturedAt.getTime() >= 5 * 60_000;
    if (changed) {
      await db.insert(marketPriceSnapshots).values({
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
      snapshotsStored += 1;
    }

    if (
      normalizedId &&
      opportunity.model.probabilityBps !== null &&
      opportunity.executablePriceBps !== null &&
      opportunity.edgeBps !== null
    ) {
      const latestPrediction = latestPredictionByListing.get(listingId);
      const recommendedProbabilityBps =
        opportunity.recommendedProbabilityBps ??
        opportunity.model.probabilityBps;
      const predictionChanged =
        !latestPrediction ||
        Math.abs(
          latestPrediction.predictedProbabilityBps - recommendedProbabilityBps,
        ) >= 100 ||
        Math.abs(
          latestPrediction.executablePriceBps - opportunity.executablePriceBps,
        ) >= 100 ||
        typeof latestPrediction.features.lynervaScore !== "number" ||
        now.getTime() - latestPrediction.predictedAt.getTime() >= 2 * 60 * 60_000;

      if (!predictionChanged) continue;

      await db.insert(predictions).values({
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
          projectionSeason: opportunity.model.components?.projectionSeason ?? null,
          projectionWeek: opportunity.model.components?.projectionWeek ?? null,
          matchup: opportunity.canonical?.matchup ?? null,
          subject: opportunity.canonical?.subject ?? null,
          historicalSampleSize: opportunity.model.evidence.sampleSize,
          live: opportunity.isLive,
          consensusProjection: opportunity.model.components?.consensusProjection ?? null,
          consensusProbabilityBps: opportunity.model.components?.consensusProbabilityBps ?? null,
          statisticalProbabilityBps: opportunity.model.components?.statisticalProbabilityBps ?? null,
          contextAdjustmentBps: opportunity.model.components?.contextAdjustmentBps ?? 0,
          projectionSourceCount: opportunity.model.components?.projectionSourceCount ?? 0,
          learnedCalibrationSample: opportunity.model.components?.learnedCalibrationSample ?? 0,
          learnedCalibrationActive: opportunity.model.components?.learnedCalibrationActive ?? false,
        },
        explanation: opportunity.model.factors,
        predictedAt: now,
      });
      latestPredictionByListing.set(listingId, {
        listingId,
        predictedProbabilityBps: recommendedProbabilityBps,
        executablePriceBps: opportunity.executablePriceBps,
        features: {
          lynervaScore: opportunity.lynervaScore ?? null,
        },
        predictedAt: now,
      });
      predictionsStored += 1;
    }
  }
  return {
    listingsStored,
    snapshotsStored,
    predictionsStored,
    sourceProjectionsStored,
  };
}
