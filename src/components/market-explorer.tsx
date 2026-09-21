"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { getNflTeam } from "@/lib/nfl/teams";
import { isPricedOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets } from "@/lib/markets/filters";
import {
  marketFamilyLabel,
  marketMatchesSearchIntent,
  parseMarketSearchQuery,
} from "@/lib/markets/search";
import type {
  MarketFamily,
  MarketFilters,
} from "@/lib/markets/types";
import { MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { teamLogo } from "./subject-visual";
import { relativeTime } from "@/lib/utils";

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
  const {
    providers,
    refreshing,
    error,
    ratedCount,
    displayedCount,
    fetchedAt,
  } = useMarketData();

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
              {offline ? "feed offline" : `${provider.count} markets`}
            </span>
          </span>
        );
      })}
      <span className="feed-pill text-muted">
        <span className={refreshing ? "refresh-dot is-refreshing" : "refresh-dot"} />
        {refreshing
          ? "Refreshing live odds"
          : `${ratedCount} markets rated · ${displayedCount} ranked picks`}
      </span>
      <span className="feed-pill text-muted">
        Odds refreshed {fetchedAt ? relativeTime(fetchedAt) : "just now"}
      </span>
      {error ? (
        <span className="feed-pill border-warning/30 bg-warning-bg text-warning">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function normalizePlayerName(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeGameKey(value: string | null) {
  if (!value) return null;
  const teams = value
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .map((team) => (team === "WSH" ? "WAS" : team));
  if (teams.length !== 2) return null;
  return teams.toSorted().join("-");
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
  const searchParams = useSearchParams();
  const initialGame = normalizeGameKey(searchParams.get("game"));
  const initialTeam = getNflTeam(searchParams.get("team") ?? "");
  const initialQuery =
    initialGame?.replace("-", " vs ") ??
    initialTeam?.fullName ??
    searchParams.get("q")?.trim() ??
    "";
  const [filters, setFilters] = useState<MarketFilters>({
    ...DEFAULT_FILTERS,
    query: initialQuery,
    status: forceStatus ?? "all",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [urlGame, setUrlGame] = useState<string | null>(initialGame);
  const [teamRosterNames, setTeamRosterNames] = useState<Set<string> | null>(
    null,
  );
  const [teamRosterLoading, setTeamRosterLoading] = useState(false);
  const deferredQuery = useDeferredValue(filters.query);

  const searchIntent = useMemo(
    () => parseMarketSearchQuery(deferredQuery),
    [deferredQuery],
  );
  const resolvedTeam =
    searchIntent.teams.length === 1 ? searchIntent.teams[0]! : null;
  const inferredGame = useMemo(() => {
    if (searchIntent.teams.length < 2) return null;
    return searchIntent.teams
      .slice(0, 2)
      .map((team) => team.code)
      .toSorted()
      .join("-");
  }, [searchIntent.teams]);
  const activeGame = urlGame ?? inferredGame;
  const searchMoneylineOnly =
    searchIntent.families.length === 1 &&
    searchIntent.families[0] === "moneyline";
  const needsTeamRoster =
    Boolean(resolvedTeam) &&
    !activeGame &&
    filters.family !== "moneyline" &&
    !searchMoneylineOnly;
  const resolvedTeamCode = resolvedTeam?.code ?? null;
  const activeRosterNames = needsTeamRoster ? teamRosterNames : null;
  const activeRosterLoading = needsTeamRoster ? teamRosterLoading : false;

  useEffect(() => {
    if (!resolvedTeamCode || activeGame || !needsTeamRoster) return;

    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) setTeamRosterLoading(true);
        return fetch(
          `/api/team-roster?team=${encodeURIComponent(resolvedTeamCode)}`,
          { signal: controller.signal },
        );
      })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(
        (payload: {
          players: Array<{ fullName: string; footballName: string | null }>;
        }) => {
          const names = new Set<string>();
          for (const player of payload.players ?? []) {
            names.add(normalizePlayerName(player.fullName));
            if (player.footballName) {
              names.add(normalizePlayerName(player.footballName));
            }
          }
          setTeamRosterNames(names);
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) setTeamRosterNames(new Set());
      })
      .finally(() => {
        if (!controller.signal.aborted) setTeamRosterLoading(false);
      });

    return () => controller.abort();
  }, [activeGame, needsTeamRoster, resolvedTeamCode]);

  const visible = useMemo(() => {
    const activeFilters: MarketFilters = {
      ...filters,
      // Search intent is handled below instead of requiring a literal phrase
      // to appear in provider market titles.
      query: "",
      status: forceStatus ?? filters.status,
    };

    // The untouched board remains recommendation-only. Selecting Moneyline or
    // entering an explicit search turns Markets into a browser so a requested
    // team/player contract is not hidden simply because its edge is <= 0.
    const browseAllMoneylines =
      activeFilters.family === "moneyline" || searchMoneylineOnly;
    const browseExplicitSearch = Boolean(searchIntent.normalized);
    let eligible = opportunities.filter(
      (market) =>
        isPricedOpportunity(market) &&
        (browseAllMoneylines ||
          browseExplicitSearch ||
          (market.edgeBps ?? 0) > 0),
    );

    if (activeGame) {
      eligible = eligible.filter(
        (market) => market.canonical?.matchup === activeGame,
      );
    }

    if (searchIntent.normalized) {
      eligible = eligible.filter((market) =>
        marketMatchesSearchIntent(market, searchIntent, activeRosterNames),
      );
    }

    const sorted = filterAndSortMarkets(eligible, activeFilters);
    return sorted.slice(0, topOnly ? 1_500 : 1_500);
  }, [
    activeGame,
    filters,
    forceStatus,
    opportunities,
    searchIntent,
    searchMoneylineOnly,
    activeRosterNames,
    topOnly,
  ]);

  const activeAdvanced = [
    filters.minModelBps,
    filters.minEdgeBps,
    filters.minLiquidityCents,
    filters.minHitRateBps,
  ].filter((value) => value !== null).length;

  const update = <K extends keyof MarketFilters,>(
    key: K,
    value: MarketFilters[K],
  ) => {
    if (key === "query") setUrlGame(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearSearchContext = () => {
    setUrlGame(null);
    setTeamRosterNames(null);
    setFilters((current) => ({ ...current, query: "" }));
    window.history.replaceState({}, "", window.location.pathname);
  };

  return (
    <>
      <div className="filter-dock premium-panel sticky top-[58px] z-30 mb-3 rounded-2xl p-2.5 backdrop-blur-xl sm:top-14">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <label className="relative col-span-2 min-w-0 sm:col-span-1 sm:min-w-[220px] sm:flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder='Try "KC moneyline", "Mahomes pass yds", or "Chase over 80"…'
              className="h-10 w-full rounded-lg border bg-surface pl-9 pr-3 text-xs outline-none placeholder:text-faint focus:border-accent"
            />
          </label>

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
            <option value="passing_yards">Passing yards</option>
            <option value="passing_touchdowns">Passing TDs</option>
            <option value="passing_interceptions">Interceptions</option>
            <option value="rushing_yards">Rushing yards</option>
            <option value="receiving_yards">Receiving yards</option>
            <option value="receptions">Receptions</option>
            <option value="touchdowns">Anytime TDs</option>
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

        {activeGame || resolvedTeam ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <div className="flex min-w-0 items-center gap-2">
              {activeGame ? (
                <>
                  {activeGame.split("-").map((team) => (
                    <span
                      key={team}
                      className="grid size-7 place-items-center rounded-lg border bg-surface p-1"
                    >
                      <Image
                        unoptimized
                        src={teamLogo(team)}
                        alt=""
                        width={28}
                        height={28}
                        className="size-full object-contain"
                      />
                    </span>
                  ))}
                  <span className="text-[11px] font-medium">
                    Best bets for {activeGame.replace("-", " vs ")}
                  </span>
                </>
              ) : resolvedTeam ? (
                <>
                  <span className="grid size-7 place-items-center rounded-lg border bg-surface p-1">
                    <Image
                      unoptimized
                      src={teamLogo(resolvedTeam.code)}
                      alt=""
                      width={28}
                      height={28}
                      className="size-full object-contain"
                    />
                  </span>
                  <span className="text-[11px] font-medium">
                    {activeRosterLoading
                      ? `Loading ${resolvedTeam.name} players…`
                      : searchMoneylineOnly || filters.family === "moneyline"
                        ? `${resolvedTeam.fullName} moneyline`
                        : searchIntent.families.length === 1
                          ? `${resolvedTeam.fullName} ${marketFamilyLabel(searchIntent.families[0]!)}`
                          : `${resolvedTeam.fullName} markets`}
                  </span>
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={clearSearchContext}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted hover:bg-surface hover:text-foreground"
            >
              <X size={11} />
              Clear
            </button>
          </div>
        ) : null}

        {advancedOpen ? (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4">
            {[
              ["minModelBps", "Min model chance %"],
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

      {(loading && opportunities.length === 0) || activeRosterLoading ? (
        <LoadingTable />
      ) : (
        <MarketTable
          markets={visible}
          emptyMessage={
            filters.query.trim()
              ? `No markets match “${filters.query.trim()}”. Try a team, player, stat, or simpler shorthand.`
              : filters.family === "moneyline"
                ? "No current NFL moneylines match these filters."
                : emptyMessage
          }
        />
      )}
    </>
  );
}
