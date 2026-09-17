import { describe, expect, it } from "vitest";
import { inferredPayoutCents, positionProfitCents, positionRoi } from "./math";

describe("tracker P/L", () => {
  it("infers a winning binary-contract payout from stake and entry price", () => {
    const input = { stakeCents: 5_400, entryPriceBps: 5_400, status: "win" as const, manualPayoutCents: null };
    expect(inferredPayoutCents(input)).toBe(10_000);
    expect(positionProfitCents(input)).toBe(4_600);
    expect(positionRoi(input)).toBeCloseTo(0.85185, 4);
  });

  it("handles loss, push, open, and manual payout without guessing", () => {
    expect(positionProfitCents({ stakeCents: 1_000, entryPriceBps: null, status: "loss", manualPayoutCents: null })).toBe(-1_000);
    expect(positionProfitCents({ stakeCents: 1_000, entryPriceBps: null, status: "push", manualPayoutCents: null })).toBe(0);
    expect(positionProfitCents({ stakeCents: 1_000, entryPriceBps: null, status: "open", manualPayoutCents: null })).toBeNull();
    expect(positionProfitCents({ stakeCents: 1_000, entryPriceBps: null, status: "win", manualPayoutCents: 1_700 })).toBe(700);
  });
});
