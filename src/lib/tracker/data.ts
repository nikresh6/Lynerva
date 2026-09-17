import "server-only";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { userPositions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { inferredPayoutCents, positionProfitCents } from "./math";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user;
}

export interface TrackerFilters {
  platform?: "kalshi" | "polymarket";
  status?: "open" | "win" | "loss" | "push";
  type?: "single" | "combination";
  from?: Date;
  to?: Date;
}

export async function getPositions(filters: TrackerFilters = {}) {
  const currentUser = await requireUser();
  const conditions = [eq(userPositions.userId, currentUser.id)];
  if (filters.platform) conditions.push(eq(userPositions.platform, filters.platform));
  if (filters.status) conditions.push(eq(userPositions.status, filters.status));
  if (filters.type) conditions.push(eq(userPositions.type, filters.type));
  if (filters.from) conditions.push(gte(userPositions.placedAt, filters.from));
  if (filters.to) conditions.push(lte(userPositions.placedAt, filters.to));
  return getDb()
    .select()
    .from(userPositions)
    .where(and(...conditions))
    .orderBy(desc(userPositions.placedAt), desc(userPositions.createdAt));
}

export function trackerSummary(
  positions: Array<typeof userPositions.$inferSelect>,
) {
  let amountRisked = 0;
  let openExposure = 0;
  let settledRisk = 0;
  let netProfit = 0;
  let wins = 0;
  let decisions = 0;
  for (const position of positions) {
    amountRisked += position.stakeCents;
    if (position.status === "open") {
      openExposure += position.stakeCents;
      continue;
    }
    settledRisk += position.stakeCents;
    const profit = positionProfitCents({
      stakeCents: position.stakeCents,
      entryPriceBps: position.entryPriceBps,
      status: position.status as "open" | "win" | "loss" | "push",
      manualPayoutCents: position.payoutCents,
    });
    netProfit += profit ?? 0;
    if (position.status === "win") wins += 1;
    if (position.status === "win" || position.status === "loss") decisions += 1;
  }
  return {
    netProfitCents: netProfit,
    roi: settledRisk > 0 ? netProfit / settledRisk : 0,
    amountRiskedCents: amountRisked,
    winRate: decisions > 0 ? wins / decisions : 0,
    openExposureCents: openExposure,
  };
}

export function positionView(position: typeof userPositions.$inferSelect) {
  const status = position.status as "open" | "win" | "loss" | "push";
  return {
    ...position,
    payoutCents: inferredPayoutCents({
      stakeCents: position.stakeCents,
      entryPriceBps: position.entryPriceBps,
      status,
      manualPayoutCents: position.payoutCents,
    }),
    profitCents: positionProfitCents({
      stakeCents: position.stakeCents,
      entryPriceBps: position.entryPriceBps,
      status,
      manualPayoutCents: position.payoutCents,
    }),
  };
}
