import "server-only";

import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketEvents,
  marketListings,
  marketPriceSnapshots,
  modelVersions,
  normalizedMarkets,
  predictions,
  sourceHealth,
} from "@/db/schema";
import type { MarketsPayload } from "./service";

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

const MODEL_ID = "model_baseline_logit_v1";

export async function persistMarkets(payload: MarketsPayload) {
  const db = getDb();
  const now = new Date();
  let listingsStored = 0;
  let snapshotsStored = 0;
  let predictionsStored = 0;

  await db
    .insert(modelVersions)
    .values({
      id: MODEL_ID,
      name: "Lynerva baseline",
      version: "baseline-logit-v1",
      family: "player_props",
      coefficients: {
        intercept: -1.18,
        seasonHitRate: 1.25,
        recentHitRate: 0.95,
        recentPerformanceRatio: 0.42,
        sampleSize: 0.018,
      },
      calibrationNotes:
        "Regularized baseline. Chronological validation metrics are populated after the first completed training window.",
      active: true,
    })
    .onConflictDoNothing({ target: modelVersions.id });

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
        },
        explanation: opportunity.model.factors,
        predictedAt: now,
      });
      predictionsStored += 1;
    }
  }
  return { listingsStored, snapshotsStored, predictionsStored };
}
