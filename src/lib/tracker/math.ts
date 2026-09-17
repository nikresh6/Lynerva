export type PositionStatus = "open" | "win" | "loss" | "push";

export function inferredPayoutCents(input: {
  stakeCents: number;
  entryPriceBps: number | null;
  status: PositionStatus;
  manualPayoutCents: number | null;
}) {
  if (input.status === "open") return null;
  if (input.manualPayoutCents !== null) return input.manualPayoutCents;
  if (input.status === "loss") return 0;
  if (input.status === "push") return input.stakeCents;
  if (input.entryPriceBps && input.entryPriceBps > 0) {
    return Math.round(input.stakeCents / (input.entryPriceBps / 10_000));
  }
  return null;
}

export function positionProfitCents(input: {
  stakeCents: number;
  entryPriceBps: number | null;
  status: PositionStatus;
  manualPayoutCents: number | null;
}) {
  const payout = inferredPayoutCents(input);
  return payout === null ? null : payout - input.stakeCents;
}

export function positionRoi(input: {
  stakeCents: number;
  entryPriceBps: number | null;
  status: PositionStatus;
  manualPayoutCents: number | null;
}) {
  const profit = positionProfitCents(input);
  return profit === null || input.stakeCents <= 0
    ? null
    : profit / input.stakeCents;
}
