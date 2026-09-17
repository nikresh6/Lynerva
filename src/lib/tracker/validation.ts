import { z } from "zod";

const money = z.coerce.number().finite().min(0).max(10_000_000);

export const positionInputSchema = z.object({
  placedAt: z.coerce.date(),
  platform: z.enum(["kalshi", "polymarket"]),
  type: z.enum(["single", "combination"]),
  description: z.string().trim().min(2).max(300),
  stake: money.refine((value) => value > 0, "Stake must be greater than zero"),
  entryPrice: z
    .union([z.literal(""), z.coerce.number().finite().min(0.01).max(0.99)])
    .transform((value) => (value === "" ? null : value)),
  status: z.enum(["open", "win", "loss", "push"]),
  payout: z
    .union([z.literal(""), money])
    .transform((value) => (value === "" ? null : value)),
  notes: z.string().trim().max(1_000).optional().transform((value) => value || null),
});

export type PositionInput = z.infer<typeof positionInputSchema>;
