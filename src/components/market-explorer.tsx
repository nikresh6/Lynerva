"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { isTopOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets } from "@/lib/markets/filters";
import type {
  MarketFamily,
  MarketFilters,
  MarketOpportunity,
  Platform,
} from "@/lib/markets/types";
import { MarketTable } from "./market-table";

const DEFAULT_FILTERS: MarketFilters = {
  query: "",
  platform: "all",
  status: "all",
  family: "all",
  side: "all",
  minPriceBps: null,
  maxPriceBps: null,
  minModelBps: null,
  minEdgeBps: null,
  minLiquidityCents: null,
  minHitRateBps: null,
  sort: "best",
};

function Select({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 appearance-none rounded-lg border bg-surface py-1 pl-3 pr-8 text-xs text-foreground outline-none transition-colors hover:border-border-strong focus:border-foreground"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted">
        ▾
      </span>
    </label>
  );
}

export function MarketExplorer({
  initialMarkets,
  forceStatus,
  pollIntervalMs = 10_000,
  emptyMessage,
}: {
  initialMarkets: MarketOpportunity[];
  forceStatus?: "live" | "pregame";
  pollIntervalMs?: number;
  emptyMessage?: string;
}) {
  const [markets, setMarkets] = useState(initialMarkets);
  const [filters, setFilters] = useState<MarketFilters>({
    ...DEFAULT_FILTERS,
    status: forceStatus ?? "all",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const deferredQuery = useDeferredValue(filters.query);

  useEffect(() => {
    setMarkets(initialMarkets);
  }, [initialMarkets]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/markets", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          opportunities: MarketOpportunity[];
        };
        if (!cancelled) {
          setMarkets(payload.opportunities);
        }
      } catch {
        // Keep the last good snapshot visible.
      }
    };

    const timer = window.setInterval(refresh, pollIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollIntervalMs]);

  const visible = useMemo(() => {
    const activeFilters: MarketFilters = {
      ...filters,
      query: deferredQuery,
      status: forceStatus ?? filters.status,
    };
    return filterAndSortMarkets(
      markets.filter(isTopOpportunity),
      activeFilters,
    ).slice(0, 120);
  }, [deferredQuery, filters, forceStatus, markets]);

  const activeAdvanced = [
    filters.minModelBps,
    filters.minEdgeBps,
    filters.minLiquidityCents,
    filters.minHitRateBps,
  ].filter((value) => value !== null).length;

  const update = <K extends keyof MarketFilters,>(
    key: K,
    value: MarketFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <div className="sticky top-14 z-30 mb-3 rounded-xl border bg-[var(--header)] p-2 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="Player, team, market…"
              className="h-10 w-full rounded-lg border bg-surface pl-9 pr-3 text-xs outline-none placeholder:text-faint focus:border-foreground"
            />
          </label>

          <Select
            value={filters.platform}
            onChange={(value) =>
              update("platform", value as "all" | Platform)
            }
            label="Platform"
          >
            <option value="all">All platforms</option>
            <option value="kalshi">Kalshi</option>
            <option value="polymarket">Polymarket</option>
          </Select>

          {!forceStatus ? (
            <Select
              value={filters.status}
              onChange={(value) =>
                update("status", value as MarketFilters["status"])
              }
              label="Status"
            >
              <option value="all">All status</option>
              <option value="pregame">Pregame</option>
              <option value="live">Live</option>
            </Select>
          ) : null}

          <Select
            value={filters.family}
            onChange={(value) =>
              update("family", value as "all" | MarketFamily)
            }
            label="Market type"
          >
            <option value="all">All markets</option>
            <option value="moneyline">Moneyline</option>
            <option value="spread">Spread</option>
            <option value="game_total">Game total</option>
            <option value="passing_yards">Passing yards</option>
            <option value="passing_touchdowns">Passing TDs</option>
            <option value="rushing_yards">Rushing yards</option>
            <option value="receiving_yards">Receiving yards</option>
            <option value="receptions">Receptions</option>
            <option value="touchdowns">Touchdowns</option>
          </Select>

          <Select
            value={filters.sort}
            onChange={(value) =>
              update("sort", value as MarketFilters["sort"])
            }
            label="Sort"
          >
            <option value="best">Best opportunity</option>
            <option value="edge">Highest edge</option>
            <option value="probability">Model probability</option>
            <option value="risk_return">Risk : return</option>
            <option value="liquidity">Liquidity</option>
          </Select>

          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-xs hover:border-border-strong"
          >
            <SlidersHorizontal size={13} />
            More
            {activeAdvanced ? (
              <span className="rounded-full bg-foreground px-1.5 text-[9px] text-background">
                {activeAdvanced}
              </span>
            ) : null}
          </button>
        </div>

        {advancedOpen ? (
          <div className="mt-2 grid gap-2 border-t pt-2 sm:grid-cols-4">
            {[
              ["minModelBps", "Min model %"],
              ["minEdgeBps", "Min edge pp"],
              ["minLiquidityCents", "Min liquidity $"],
              ["minHitRateBps", "Min hit rate %"],
            ].map(([key, label]) => {
              const typedKey = key as
                | "minModelBps"
                | "minEdgeBps"
                | "minLiquidityCents"
                | "minHitRateBps";
              const current = filters[typedKey];
              const divisor = typedKey === "minLiquidityCents" ? 100 : 100;
              return (
                <label key={key} className="text-[10px] text-muted">
                  {label}
                  <input
                    type="number"
                    value={current === null ? "" : current / divisor}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      update(
                        typedKey,
                        event.target.value === "" || !Number.isFinite(value)
                          ? null
                          : Math.round(value * divisor),
                      );
                    }}
                    className="mt-1 h-9 w-full rounded-lg border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-foreground"
                  />
                </label>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setFilters({
                  ...DEFAULT_FILTERS,
                  status: forceStatus ?? "all",
                })
              }
              className="sm:col-span-4 ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
            >
              <X size={12} /> Clear filters
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex items-center justify-between text-[10px] text-faint">
        <span>{visible.length} ranked picks</span>
        <span>Live prices refresh automatically</span>
      </div>

      <MarketTable markets={visible} emptyMessage={emptyMessage} />
    </>
  );
}
