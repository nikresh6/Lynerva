import { describe, expect, it } from "vitest";
import { resolveProjectionPlayer } from "./external-projections";

describe("projection player resolution", () => {
  it("keeps Brian Robinson Jr. separate from Bijan Robinson", () => {
    const entries: Array<[string, { rushingYards: number }]> = [
      ["Bijan Robinson", { rushingYards: 90.6 }],
      ["Brian Robinson Jr.", { rushingYards: 30.0 }],
    ];

    expect(resolveProjectionPlayer(entries, "Brian Robinson Jr.")).toEqual({
      rushingYards: 30.0,
    });
    expect(resolveProjectionPlayer(entries, "Bijan Robinson")).toEqual({
      rushingYards: 90.6,
    });
  });

  it("rejects an ambiguous initial-and-last-name lookup", () => {
    const entries: Array<[string, { rushingYards: number }]> = [
      ["Bijan Robinson", { rushingYards: 80.7 }],
      ["Brian Robinson Jr.", { rushingYards: 30.0 }],
    ];

    expect(resolveProjectionPlayer(entries, "B. Robinson")).toBeNull();
  });
});
