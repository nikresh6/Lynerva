import { describe, expect, it } from "vitest";
import { resultsPickKey } from "./results-pick-key";

describe("Results forecast star identity", () => {
  const listing = {
    platform: "kalshi",
    platformMarketId: "KXNFLPLAYER-TEST",
    platformOutcomeId: null,
  };

  it("matches a prediction to the identical executable listing and side", () => {
    expect(resultsPickKey({ ...listing, side: "yes" })).toBe(
      resultsPickKey({ ...listing, platformOutcomeId: "yes", side: "yes" }),
    );
  });

  it("does not mark a different side, contract or platform as slated", () => {
    const current = resultsPickKey({ ...listing, side: "yes" });
    expect(resultsPickKey({ ...listing, side: "no" })).not.toBe(current);
    expect(resultsPickKey({ ...listing, platformMarketId: "OTHER", side: "yes" })).not.toBe(current);
    expect(resultsPickKey({ ...listing, platform: "other", side: "yes" })).not.toBe(current);
  });
});
