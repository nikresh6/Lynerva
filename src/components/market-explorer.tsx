"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { findNflTeamsInQuery, getNflTeam, resolveNflTeamQuery } from "@/lib/nfl/teams";
import { isPricedOpportunity } from "@/lib/markets/eligibility";
import { filterAndSortMarkets } from "@/lib/markets/filters";
import type {
  MarketFamily,
  MarketFilters,
  Platform,
} from "@/lib/markets/types";
import { MarketTable } from "./market-table";
import { useMarketData } from "./market-data-provider";
import { teamLogo } from "./subject-visual";

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
  const [filters, setFilters] = useState<MarketFilters>({
    ...DEFAULT_FILTERS,
    status: forceStatus ?? "all",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [urlGame, setUrlGame] = useState<string | null>(null);
  const [teamRosterNames, setTeamRosterNames] = useState<Set<string> | null>(
    null,
  );
  const [teamRosterLoading, setTeamRosterLoading] = useState(false);
  const deferredQuery = useDeferredValue(filters.query);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const game = normalizeGameKey(params.get("game"));
    const team = getNflTeam(params.get("team") ?? "");
    const query = params.get("q")?.trim() ?? "";

    if (game) {
      setUrlGame(game);
      setFilters((current) => ({
        ...current,
        query: game.replace("-", " vs "),
        status: forceStatus ?? current.status,
      }));
      return;
    }

    if (team) {
      setFilters((current) => ({
        ...current,
        query: team.fullName,
        status: forceStatus ?? current.status,
      }));
      return;
    }

    if (query) {
      setFilters((current) => ({
        ...current,
        query,
        status: forceStatus ?? current.status,
      }));
    }
  }, [forceStatus]);

  const resolvedTeam = useMemo(
    () => resolveNflTeamQuery(deferredQuery),
    [deferredQuery],
  );
  const queryTeams = useMemo(
    () => findNflTeamsInQuery(deferredQuery),
    [deferredQuery],
  );
  const inferredGame = useMemo(() => {
    if (queryTeams.length < 2) return null;
    return queryTeams
      .slice(0, 2)
      .map((team) => team.code)
      .toSorted()
      .join("-");
  }, [queryTeams]);
  const activeGame = urlGame ?? inferredGame;

  useEffect(() => {
    if (!resolvedTeam || activeGame) {
      setTeamRosterNames(null);
      setTeamRosterLoading(false);
      return;
    }

    const controller = new AbortController();
    setTeamRosterLoading(true);
    fetch(`/api/team-roster?team=${encodeURIComponent(resolvedTeam.code)}`, {
      signal: controller.signal,
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
  }, [activeGame, resolvedTeam?.code]);

  const visible = useMemo(() => {
    const activeFilters: MarketFilters = {
      ...filters,
      query: resolvedTeam || activeGame ? "" : deferredQuery,
      status: forceStatus ?? filters.status,
    };

    let eligible = opportunities.filter(isPricedOpportunity);

    if (activeGame) {
      eligible = eligible.filter(
        (market) => market.canonical?.matchup === activeGame,
      );
    } else if (resolvedTeam && teamRosterNames) {
      eligible = eligible.filter((market) => {
        const subject = market.canonical?.subject;
        return subject
          ? teamRosterNames.has(normalizePlayerName(subject))
          : false;
      });
    }

    const sorted = filterAndSortMarkets(eligible, activeFilters);
    return sorted.slice(0, topOnly ? 1_500 : 1_500);
  }, [
    activeGame,
    deferredQuery,
    filters,
    forceStatus,
    opportunities,
    resolvedTeam,
    teamRosterNames,
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
      <div className="filter-dock premium-panel sticky top-[94px] z-30 mb-3 rounded-2xl p-2.5 backdrop-blur-xl sm:top-14">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <label className="relative col-span-2 min-w-0 sm:col-span-1 sm:min-w-[220px] sm:flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              placeholder="Player, team, or game…"
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
            <option value="passing_interceptions">Interceptions</option>
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
                      <img
                        src={teamLogo(team)}
                        alt=""
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
                    <img
                      src={teamLogo(resolvedTeam.code)}
                      alt=""
                      className="size-full object-contain"
                    />
                  </span>
                  <span className="text-[11px] font-medium">
                    {teamRosterLoading
                      ? `Loading ${resolvedTeam.name} players…`
                      : `${resolvedTeam.fullName} player props`}
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

      {(loading && opportunities.length === 0) || teamRosterLoading ? (
        <LoadingTable />
      ) : (
        <MarketTable markets={visible} emptyMessage={emptyMessage} />
      )}
    </>
  );
}
