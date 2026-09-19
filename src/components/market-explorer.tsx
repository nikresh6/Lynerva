"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { isPricedOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets } from "@/lib/markets/filters";
import type {
  MarketFamily,
  MarketFilters,
  Platform,
} from "@/lib/markets/types";
import { MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";

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
    <label className="relative min-w-0 flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-lg border bg-surface py-1 pl-3 pr-8 text-xs text-foreground outline-none transition-colors hover:border-border-strong focus:border-accent sm:w-auto"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted">
        ▾
      </span>
    </label>
  );
}

function FeedStatus() {
  const { providers, refreshing, error, ratedCount, displayedCount } = useMarketData();

  return (
    <div className="scrollbar-subtle -mx-1 mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 text-[10px] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {providers.map((provider) => {
        const offline = Boolean(provider.error);
        return (
          <span
            key={provider.provider}
            className="feed-pill"
          >
            <span
              className={
                offline
                  ? "size-1.5 rounded-full bg-negative"
                  : provider.count > 0
                    ? "size-1.5 rounded-full bg-positive"
                    : "size-1.5 rounded-full bg-warning"
              }
            />
            <span className="font-semibold capitalize text-foreground">{provider.provider}</span>
            <span className="text-faint">
              {offline ? "feed offline" : `${provider.count} props`}
            </span>
          </span>
        );
      })}
      <span className="feed-pill text-muted">
        <span className={refreshing ? "refresh-dot is-refreshing" : "refresh-dot"} />
        {refreshing
          ? "Refreshing live odds"
          : `${ratedCount} props rated · ${displayedCount} ranked picks`}
      </span>
      {error ? (
        <span className="feed-pill border-warning/30 bg-warning-bg text-warning">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((value) => (
        <div key={value} className="rounded-2xl border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="size-12 animate-pulse rounded-xl bg-border" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-border" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-border" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-border" />
            </div>
            <div className="size-14 animate-pulse rounded-full bg-border" />
          </div>
          <div className="mt-4 h-16 animate-pulse rounded-xl bg-background" />
        </div>
      ))}
    </div>
  );
}

export function MarketExplorer({
  forceStatus,
  emptyMessage,
  topOnly = true,
}: {
  forceStatus?: "live" | "pregame";
  emptyMessage?: string;
  topOnly?: boolean;
}) {
  const { opportunities, loading } = useMarketData();
  const [filters, setFilters] = useState<MarketFilters>({
    ...DEFAULT_FILTERS,
    status: forceStatus ?? "all",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const deferredQuery = useDeferredValue(filters.query);

  const visible = useMemo(() => {
    const activeFilters: MarketFilters = {
      ...filters,
      query: deferredQuery,
      status: forceStatus ?? filters.status,
    };
    // Search and filters operate on the entire rated weekly universe.
    // MarketTable handles the final top-30 grouping after filtering.
    const eligible = opportunities.filter(isPricedOpportunity);
    const sorted = filterAndSortMarkets(eligible, activeFilters);
    return sorted.slice(0, topOnly ? 1_500 : 1_500);
  }, [deferredQuery, filters, forceStatus, opportunities, topOnly]);

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
      <div className="filter-dock premium-panel sticky top-14 z-30 mb-3 rounded-2xl p-2.5 backdrop-blur-xl sm:top-14">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <label className="relative col-span-2 min-w-0 sm:col-span-1 sm:min-w-[220px] sm:flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="Player, team, market…"
              className="h-10 w-full rounded-lg border bg-surface pl-9 pr-3 text-xs outline-none placeholder:text-faint focus:border-accent"
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
            <option value="all">All player props</option>
            <option value="passing_yards">Passing yards</option>
            <option value="passing_touchdowns">Passing TDs</option>
            <option value="rushing_yards">Rushing yards</option>
            <option value="receiving_yards">Receiving yards</option>
            <option value="receptions">Receptions</option>
                        <option value="touchdowns">Touchdowns</option>
          </Select>

          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border bg-surface px-3 text-xs transition-colors hover:border-border-strong hover:bg-surface-raised sm:w-auto"
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
          <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4">
            {[
              ["minModelBps", "Min Lynerva chance %"],
              ["minEdgeBps", "Min advantage %"],
              ["minLiquidityCents", "Min market activity $"],
              ["minHitRateBps", "Min hit rate %"],
            ].map(([key, label]) => {
              const typedKey = key as
                | "minModelBps"
                | "minEdgeBps"
                | "minLiquidityCents"
                | "minHitRateBps";
              const current = filters[typedKey];
              return (
                <label key={key} className="text-[10px] text-muted">
                  {label}
                  <input
                    type="number"
                    value={current === null ? "" : current / 100}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      update(
                        typedKey,
                        event.target.value === "" || !Number.isFinite(value)
                          ? null
                          : Math.round(value * 100),
                      );
                    }}
                    className="mt-1 h-9 w-full rounded-lg border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-accent"
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
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground sm:col-span-4"
            >
              <X size={12} /> Clear filters
            </button>
          </div>
        ) : null}
      </div>

      <FeedStatus />

      {loading && opportunities.length === 0 ? (
        <LoadingTable />
      ) : (
        <MarketTable markets={visible} emptyMessage={emptyMessage} />
      )}
    </>
  );
}
