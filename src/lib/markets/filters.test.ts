import { describe, expect, it } from "vitest";
import { parseMarketFilters } from "./filters";

describe("filter query parsing", () => {
  it("converts display units to stored basis points and cents", () => {
    const filters = parseMarketFilters({ platform: "kalshi", status: "live", edgeMin: "7.5", liquidityMin: "2500", q: " chase " });
    expect(filters).toMatchObject({ platform: "kalshi", status: "live", minEdgeBps: 750, minLiquidityCents: 250_000, query: "chase" });
  });

  it("falls back safely for invalid enum values", () => {
    const filters = parseMarketFilters({ platform: "unknown", sort: "magic" });
    expect(filters.platform).toBe("all");
    expect(filters.sort).toBe("best");
  });
});
