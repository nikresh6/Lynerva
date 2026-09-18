"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  isPricedOpportunity,
  isTopOpportunity,
} from "@/lib/markets/eligibility";
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

function FeedStatus() {
  const { providers, refreshing, error } = useMarketData();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-muted">
      {providers.map((provider) => (
        <span key={provider.provider} className="inline-flex items-center gap-1.5">
          <span
            className={
              provider.error
                ? "size-1.5 rounded-full bg-warning"
                : "size-1.5 rounded-full bg-positive"
            }
          />
          <span className="capitalize">{provider.provider}</span>
          <span className="text-faint">{provider.count} modeled markets</span>
        </span>
      ))}
      <span className="text-faint">
        {refreshing ? "Refreshing live prices…" : "Live snapshot"}
      </span>
      {error ? <span className="text-negative">{error}</span> : null}
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-5 border-b bg-surface-raised px-4 py-3">
        {[0, 1, 2, 3].map((value) => (
          <div
            key={value}
            className="h-2.5 animate-pulse rounded-full bg-border"
          />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div
          key={row}
          className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-5 border-b px-4 py-4 last:border-0"
        >
          <div className="h-3 animate-pulse rounded-full bg-border" />
          <div className="h-3 animate-pulse rounded-full bg-border" />
          <div className="h-3 animate-pulse rounded-full bg-border" />
          <div className="h-3 animate-pulse rounded-full bg-border" />
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
    const eligible = opportunities.filter(
      topOnly ? isTopOpportunity : isPricedOpportunity,
    );
    return filterAndSortMarkets(
      eligible,
      activeFilters,
    ).slice(0, topOnly ? 60 : 120);
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
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-surface px-3 text-xs transition-colors hover:border-border-strong hover:bg-surface-raised"
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
