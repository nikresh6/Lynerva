"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { userPositions } from "@/db/schema";
import { requireUser } from "@/lib/tracker/data";
import { positionInputSchema } from "@/lib/tracker/validation";
import {
  MANUAL_TRACKER_NOTES_PREFIX,
  normalizeManualTrackerBet,
  type ManualTrackerBet,
} from "@/lib/tracker/manual";

export type PositionActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

function rawPosition(formData: FormData) {
  return {
    placedAt: formData.get("placedAt"),
    platform: formData.get("platform"),
    type: formData.get("type"),
    description: formData.get("description"),
    stake: formData.get("stake"),
    entryPrice: formData.get("entryPrice") ?? "",
    status: formData.get("status"),
    payout: formData.get("payout") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

export async function createPosition(
  _previous: PositionActionState,
  formData: FormData,
): Promise<PositionActionState> {
  const currentUser = await requireUser();
  const parsed = positionInputSchema.safeParse(rawPosition(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;
  await getDb().insert(userPositions).values({
    id: crypto.randomUUID(),
    userId: currentUser.id,
    placedAt: input.placedAt,
    platform: input.platform,
    type: input.type,
    description: input.description,
    stakeCents: Math.round(input.stake * 100),
    entryPriceBps:
      input.entryPrice === null ? null : Math.round(input.entryPrice * 10_000),
    status: input.status,
    payoutCents: input.payout === null ? null : Math.round(input.payout * 100),
    notes: input.notes,
  });
  revalidatePath("/tracker");
  return { ok: true, message: "Position added." };
}

export async function updatePosition(
  id: string,
  _previous: PositionActionState,
  formData: FormData,
): Promise<PositionActionState> {
  const currentUser = await requireUser();
  const parsed = positionInputSchema.safeParse(rawPosition(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;
  await getDb()
    .update(userPositions)
    .set({
      placedAt: input.placedAt,
      platform: input.platform,
      type: input.type,
      description: input.description,
      stakeCents: Math.round(input.stake * 100),
      entryPriceBps:
        input.entryPrice === null ? null : Math.round(input.entryPrice * 10_000),
      status: input.status,
      payoutCents: input.payout === null ? null : Math.round(input.payout * 100),
      notes: input.notes,
    })
    .where(
      and(eq(userPositions.id, id), eq(userPositions.userId, currentUser.id)),
    );
  revalidatePath("/tracker");
  return { ok: true, message: "Position updated." };
}

export async function deletePosition(id: string) {
  const currentUser = await requireUser();
  await getDb()
    .delete(userPositions)
    .where(
      and(eq(userPositions.id, id), eq(userPositions.userId, currentUser.id)),
    );
  revalidatePath("/tracker");
}


async function optionalTrackerUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

function manualPositionValues(userId: string, bet: ManualTrackerBet) {
  return {
    id: bet.id,
    userId,
    placedAt: new Date(bet.date + "T12:00:00.000Z"),
    platform: "kalshi",
    type: bet.isParlay ? "combination" : "single",
    description: bet.description,
    stakeCents: Math.round(bet.stake * 100),
    entryPriceBps: bet.entryPriceBps,
    status: bet.status,
    payoutCents: bet.payout > 0 ? Math.round(bet.payout * 100) : null,
    notes: MANUAL_TRACKER_NOTES_PREFIX + JSON.stringify(bet),
  };
}

export async function loadManualTrackerBets() {
  const currentUser = await optionalTrackerUser();
  if (!currentUser) {
    return {
      authenticated: false,
      bets: [] as ManualTrackerBet[],
    };
  }

  const rows = await getDb()
    .select()
    .from(userPositions)
    .where(eq(userPositions.userId, currentUser.id))
    .orderBy(desc(userPositions.placedAt), desc(userPositions.createdAt));

  const bets = rows.flatMap((row) => {
    if (!row.notes?.startsWith(MANUAL_TRACKER_NOTES_PREFIX)) return [];
    try {
      const parsed = JSON.parse(
        row.notes.slice(MANUAL_TRACKER_NOTES_PREFIX.length),
      );
      const bet = normalizeManualTrackerBet(parsed);
      return bet ? [bet] : [];
    } catch {
      return [];
    }
  });

  return { authenticated: true, bets };
}

export async function syncManualTrackerBets(input: unknown) {
  const currentUser = await requireUser();
  if (!Array.isArray(input)) {
    return { ok: false, message: "Invalid tracker payload." };
  }

  const bets = input
    .slice(0, 500)
    .map(normalizeManualTrackerBet)
    .filter((bet): bet is ManualTrackerBet => bet !== null);
  const db = getDb();

  for (const bet of bets) {
    const values = manualPositionValues(currentUser.id, bet);
    await db.insert(userPositions).values(values).onConflictDoNothing();
    await db
      .update(userPositions)
      .set({
        placedAt: values.placedAt,
        platform: values.platform,
        type: values.type,
        description: values.description,
        stakeCents: values.stakeCents,
        entryPriceBps: values.entryPriceBps,
        status: values.status,
        payoutCents: values.payoutCents,
        notes: values.notes,
      })
      .where(
        and(
          eq(userPositions.id, bet.id),
          eq(userPositions.userId, currentUser.id),
        ),
      );
  }

  revalidatePath("/tracker");
  return { ok: true, message: "Tracker synced." };
}

export async function deleteManualTrackerBet(id: string) {
  const currentUser = await requireUser();
  await getDb()
    .delete(userPositions)
    .where(
      and(eq(userPositions.id, id), eq(userPositions.userId, currentUser.id)),
    );
  revalidatePath("/tracker");
}
