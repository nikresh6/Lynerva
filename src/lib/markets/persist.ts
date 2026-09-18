import "server-only";

import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
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
import { normalizeLearningPlayer } from "@/lib/model/source-weighting";
import type { MarketsPayload } from "./service";

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

const MODEL_ID = "model_hybrid_consensus_learning_v3";

export async function persistMarkets(payload: MarketsPayload) {
  const db = getDb();
  const now = new Date();
  let listingsStored = 0;
  let snapshotsStored = 0;
  let predictionsStored = 0;
  let sourceProjectionsStored = 0;

  await db
    .insert(modelVersions)
    .values({
      id: MODEL_ID,
      name: "Lynerva hybrid player prop model",
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
    const eventId = stableId(
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
      ? stableId("market", opportunity.canonical.key)
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

    const listingId = stableId(
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
      await db.insert(predictions).values({
        id: crypto.randomUUID(),
        normalizedMarketId: normalizedId,
        listingId,
        modelVersionId: MODEL_ID,
        predictedProbabilityBps: opportunity.model.probabilityBps,
        executablePriceBps: opportunity.executablePriceBps,
        edgeBps: opportunity.edgeBps,
        reliabilityBps: opportunity.model.reliabilityBps,
        opportunityScore: opportunity.opportunityScore ?? 0,
        sampleSize: opportunity.model.evidence.sampleSize,
        features: {
          threshold: opportunity.canonical?.threshold ?? null,
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
