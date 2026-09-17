"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { userPositions } from "@/db/schema";
import { requireUser } from "@/lib/tracker/data";
import { positionInputSchema } from "@/lib/tracker/validation";

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
