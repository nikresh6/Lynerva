import { describe, expect, it } from "vitest";
import {
  countRelevantCachedKalshiMarkets,
  shouldPreserveKalshiSnapshot,
} from "./snapshot-guard";

const mk = (game: string, index: number) => ({
  platformMarketId: `KXNFLPASSYDS-${game}-PLAYER${index}`,
  eventTitle: `KXNFLPASSYDS-${game}`,
});
const markets = (game: string, count: number) =>
  Array.from({ length: count }, (_, i) => mk(game, i));
const mondayMorning = Date.UTC(2026, 9, 12, 14, 50);

describe("Kalshi snapshot rollover", () => {
  it("does not confuse Sunday's expired slate with a partial Monday response", () => {
    const previous = [
      ...markets("26OCT11CHIGB", 3_000),
      ...markets("26OCT12BUFLAR", 382),
    ];
    const incoming = markets("26OCT12BUFLAR", 859);
    expect(countRelevantCachedKalshiMarkets(previous, mondayMorning)).toBe(382);
    expect(shouldPreserveKalshiSnapshot(previous, incoming, mondayMorning)).toBe(false);
  });

  it("still protects an active same-day slate from an incomplete provider refresh", () => {
    const previous = markets("26OCT12BUFLAR", 800);
    const incoming = markets("26OCT12BUFLAR", 60);
    expect(shouldPreserveKalshiSnapshot(previous, incoming, mondayMorning)).toBe(true);
  });

  it("retains Sunday night contracts while their game may still be active", () => {
    const lateSunday = Date.UTC(2026, 9, 12, 3, 30);
    expect(countRelevantCachedKalshiMarkets(markets("26OCT11BALATL", 5), lateSunday)).toBe(5);
  });

  it("does not protect a snapshot after every dated market has expired", () => {
    expect(shouldPreserveKalshiSnapshot(markets("26OCT11BALATL", 300), [], mondayMorning)).toBe(false);
  });

  it("conservatively preserves undated legacy entries", () => {
    const previous = [{ platformMarketId: "UNKNOWN", eventTitle: "Unrecognized" }];
    expect(countRelevantCachedKalshiMarkets(previous, mondayMorning)).toBe(1);
    expect(shouldPreserveKalshiSnapshot(previous, [], mondayMorning)).toBe(true);
  });
});
