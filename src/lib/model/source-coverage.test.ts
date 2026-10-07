import { describe, expect, it } from "vitest";
import {
  projectionSourcesForStatistic,
  sourceSupportsStatistic,
} from "./source-weighting";

describe("projection source coverage", () => {
  it("does not treat Covers or Dimers as interception sources", () => {
    expect(sourceSupportsStatistic("covers", "passing_interceptions")).toBe(false);
    expect(sourceSupportsStatistic("dimers", "passing_interceptions")).toBe(false);
    expect(projectionSourcesForStatistic("passing_interceptions")).not.toContain("covers");
    expect(projectionSourcesForStatistic("passing_interceptions")).not.toContain("dimers");
  });

  it("keeps their supported yardage stats active", () => {
    expect(sourceSupportsStatistic("covers", "receiving_yards")).toBe(true);
    expect(sourceSupportsStatistic("dimers", "receiving_yards")).toBe(true);
  });
});
