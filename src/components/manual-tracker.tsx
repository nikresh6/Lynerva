"use client";

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent } from "@/lib/utils";
import { useMarketData } from "./market-data-provider";
import { SubjectVisual } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

type TrackerStatus = "open" | "win" | "loss" | "push" | "cashed";

interface ManualBet {
  id: string;
  date: string;
  description: string;
  platform: "kalshi";
  stake: number;
  payout: number;
  status: TrackerStatus;
  marketId: string | null;
  side: "yes" | "no" | null;
  entryPriceBps: number | null;
  isLive: boolean;
  isParlay: boolean;
  legs: string[];
  legMarketIds: string[];
  legSides: Array<"yes" | "no" | null>;
  legEntryPriceBps: Array<number | null>;
  decimalOdds: number | null;
}

const STORAGE_KEY = "lynerva-manual-tracker-v2";
const LEGACY_STORAGE_KEY = "lynerva-manual-tracker-v1";

function profit(bet: ManualBet) {
  if (bet.status === "open") return null;
  if (bet.status === "loss") return -bet.stake;
  if (bet.status === "push") return 0;
  return bet.payout - bet.stake;
}

function money(value: number | null) {
  if (value === null) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function parseTrackedOdds(value: string) {
  const raw = value.trim().toLowerCase().replace(/x$/, "");
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  const looksAmerican =
    /^[+-]\d+(?:\.\d+)?$/.test(raw) ||
    (/^\d{3,}(?:\.\d+)?$/.test(raw) && numeric >= 100);

  if (looksAmerican) {
    if (numeric === 0) return null;
    return numeric > 0
      ? 1 + numeric / 100
      : 1 + 100 / Math.abs(numeric);
  }

  return numeric > 1 ? numeric : null;
}

function trackedOddsLabel(decimalOdds: number | null) {
  if (!decimalOdds || decimalOdds <= 1) return null;
  const american =
    decimalOdds >= 2
      ? Math.round((decimalOdds - 1) * 100)
      : -Math.round(100 / (decimalOdds - 1));
  return `${american > 0 ? "+" : ""}${american} · ${decimalOdds.toFixed(2)}x`;
}

function marketPickLabel(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.marketTitle;

  const takingContract = market.recommendedSide !== "no";
  const direction = takingContract
    ? canonical.direction
    : canonical.direction === "over"
      ? "under"
      : canonical.direction === "under"
        ? "over"
        : canonical.direction === "yes"
          ? "no"
          : "yes";

  if (canonical.family === "moneyline") {
    const matchupTeams = canonical.matchup?.split("-").filter(Boolean) ?? [];
    const backedTeam =
      market.recommendedSide === "no"
        ? matchupTeams.find((team) => team !== canonical.subject) ?? canonical.subject
        : canonical.subject;
    return `${backedTeam} moneyline`;
  }

  const label = canonical.family.replaceAll("_", " ");
  const threshold =
    canonical.threshold === null ? "" : ` ${canonical.threshold}`;
  const side =
    direction === "over"
      ? "Over"
      : direction === "under"
        ? "Under"
        : direction === "yes"
          ? "Yes"
          : "No";

  return `${canonical.subject}: ${side}${threshold} ${label}`;
}

const TEAM_ACCENTS: Record<string, string> = {
  ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
  CAR: "#0085CA", CHI: "#C83803", CIN: "#FB4F14", CLE: "#FF3C00",
  DAL: "#003594", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
  HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837",
  LV: "#A5ACAF", LAC: "#0080C6", LAR: "#003594", MIA: "#008E97",
  MIN: "#4F2683", NE: "#002244", NO: "#D3BC8D", NYG: "#0B2265",
  NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SF: "#AA0000",
  SEA: "#69BE28", TB: "#D50A0A", TEN: "#4B92DB", WAS: "#5A1414",
};

function marketAccentStyle(
  market: MarketOpportunity | null | undefined,
  team: string | null | undefined,
) {
  const matchupTeam = market?.canonical?.matchup?.split("-")[0] ?? null;
  const accent = TEAM_ACCENTS[team ?? ""] ?? TEAM_ACCENTS[matchupTeam ?? ""] ?? "#7C83FF";
  return {
    borderColor: `${accent}55`,
    background: `linear-gradient(135deg, ${accent}22 0%, var(--surface) 42%, var(--surface) 100%)`,
  };
}

function normalizeMarketSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/['’.-]/g, "")
    .replace(/\b(tds?|touchdowns?)\b/g, " touchdown ")
    .replace(/\b(rec|recs|receptions?)\b/g, " reception ")
    .replace(/\b(rec(?:eiving)?\s*yds?|receiving\s+yards?)\b/g, " receiving yard ")
    .replace(/\b(rush(?:ing)?\s*yds?|rushing\s+yards?)\b/g, " rushing yard ")
    .replace(/\b(pass(?:ing)?\s*yds?|passing\s+yards?)\b/g, " passing yard ")
    .replace(/\b(ints?|interceptions?)\b/g, " interception ")
    .replace(/\bml\b/g, " moneyline ")
    .replace(/\byards?\b/g, " yard ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketSearchText(market: MarketOpportunity) {
  const canonical = market.canonical;
  const family = canonical?.family ?? "";
  const aliases =
    family === "touchdowns"
      ? "td touchdown anytime touchdown anytime td score scorer"
      : family === "receptions"
        ? "rec reception catches catch"
        : family === "passing_interceptions"
          ? "int interception pick"
          : family === "moneyline"
            ? "ml moneyline win winner"
            : family.replaceAll("_", " ");

  return normalizeMarketSearch(
    [
      marketPickLabel(market),
      canonical?.matchup ?? "",
      canonical?.subject ?? "",
      canonical?.statistic ?? "",
      aliases,
      market.eventTitle,
    ].join(" "),
  );
}

function MarketPicker({
  markets,
  selectedMarketId,
  excludedIds,
  mode,
  onPick,
}: {
  markets: MarketOpportunity[];
  selectedMarketId: string;
  excludedIds: string[];
  mode: "straight" | "parlay";
  onPick: (marketId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected =
    markets.find((market) => market.platformMarketId === selectedMarketId) ??
    null;
  const clean = normalizeMarketSearch(query);
  const results = useMemo(() => {
    const tokens = clean ? clean.split(/\s+/).filter(Boolean) : [];
    return markets
      .filter((market) => !excludedIds.includes(market.platformMarketId))
      .map((market) => {
        const haystack = marketSearchText(market);
        const subject = normalizeMarketSearch(market.canonical?.subject ?? "");
        const threshold = market.canonical?.threshold;
        const matches = tokens.every((token) => haystack.includes(token));
        if (!matches) return null;

        // Search should feel like intent matching, not a browser find box.
        // Player-name matches come first, then an explicitly requested line,
        // then Lynerva score.
        const subjectHits = tokens.filter((token) => subject.includes(token)).length;
        const thresholdHit =
          threshold !== null &&
          threshold !== undefined &&
          tokens.includes(String(threshold));
        const relevance =
          subjectHits * 100 +
          (thresholdHit ? 40 : 0) +
          (market.lynervaScore ?? 0) / 100;
        return { market, relevance };
      })
      .filter(
        (row): row is { market: MarketOpportunity; relevance: number } =>
          row !== null,
      )
      .toSorted(
        (a, b) =>
          b.relevance - a.relevance ||
          (b.market.lynervaScore ?? 0) - (a.market.lynervaScore ?? 0),
      )
      .slice(0, clean ? 80 : 60)
      .map((row) => row.market);
  }, [clean, excludedIds, markets]);
  const visibleNames = useMemo(
    () =>
      results
        .map((market) => market.canonical?.subject ?? "")
        .filter(Boolean),
    [results],
  );
  const visuals = usePlayerVisuals(visibleNames);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "control-surface flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors",
          open ? "border-accent" : "",
        )}
      >
        <Search className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs">
          {mode === "straight" && selected
            ? marketPickLabel(selected)
            : mode === "parlay"
              ? "Search a player, team, game, or prop to add a leg"
              : "Search a player, team, game, or prop"}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border bg-surface shadow-[0_24px_80px_rgb(0_0_0/0.52)]">
          <div className="border-b p-2.5">
            <div className="control-surface flex h-10 items-center gap-2 rounded-xl px-3">
              <Search className="size-3.5 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try “Chase 40 yards” or “Chase TD”"
                className="w-full bg-transparent text-xs outline-none placeholder:text-faint"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="scrollbar-subtle max-h-[390px] overflow-y-auto p-1.5">
            {mode === "straight" ? (
              <button
                type="button"
                onClick={() => {
                  onPick("");
                  setQuery("");
                  setOpen(false);
                }}
                className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-muted hover:bg-surface-raised"
              >
                Manual entry
              </button>
            ) : null}
            {results.length ? (
              results.map((market) => {
                const subject = market.canonical?.subject ?? "";
                const visual = visuals[subject];
                return (
                  <button
                    type="button"
                    key={market.platformMarketId}
                    onClick={() => {
                      onPick(market.platformMarketId);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
                  >
                    <SubjectVisual market={market} visual={visual} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {marketPickLabel(market)}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-faint">
                        <span>{market.canonical?.matchup?.replace("-", " vs ") ?? "NFL"}</span>
                        <span>Kalshi {formatPercent(market.executablePriceBps)}</span>
                        <span className="text-positive">
                          Lynerva {formatPercent(market.recommendedProbabilityBps)}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-lg border bg-background px-2 py-1 text-[10px] font-bold tabular">
                      {market.lynervaScore ?? "—"}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-xs text-muted">
                No current Kalshi markets match that search.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectedMarketCard({
  market,
  onRemove,
}: {
  market: MarketOpportunity;
  onRemove?: () => void;
}) {
  const subject = market.canonical?.subject ?? "";
  const visuals = usePlayerVisuals(subject ? [subject] : []);
  const visual = visuals[subject];

  return (
    <div
      className="mt-2 flex items-center gap-3 rounded-2xl border p-3"
      style={marketAccentStyle(market, visual?.team)}
    >
      <SubjectVisual market={market} visual={visual} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{marketPickLabel(market)}</p>
        <p className="mt-1 text-[9px] text-muted">
          {market.canonical?.matchup?.replace("-", " vs ") ?? "NFL"} · Market{" "}
          {formatPercent(market.executablePriceBps)} · Lynerva{" "}
          {formatPercent(market.recommendedProbabilityBps)} · Score{" "}
          {market.lynervaScore ?? "—"}
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-background hover:text-foreground"
          aria-label="Remove leg"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function statusTone(status: TrackerStatus) {
  if (status === "win") return "bg-positive-bg text-positive";
  if (status === "loss") return "bg-negative-bg text-negative";
  if (status === "cashed") return "bg-accent-bg text-accent";
  if (status === "push") return "bg-warning-bg text-warning";
  return "bg-background text-muted";
}

function sidePrice(
  market: MarketOpportunity | undefined,
  side: "yes" | "no" | null | undefined,
) {
  if (!market || !side) return null;
  return side === "yes" ? market.yesAskBps : market.noAskBps;
}

function inferLegSide(
  market: MarketOpportunity | undefined,
  savedLabel: string | undefined,
): "yes" | "no" | null {
  if (!market?.canonical || !savedLabel) return null;
  const canonical = market.canonical;

  if (canonical.family === "moneyline") {
    const pickedTeam = savedLabel.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    if (!pickedTeam) return null;
    if (pickedTeam === canonical.subject.toUpperCase()) return "yes";
    if (canonical.matchup?.split("-").includes(pickedTeam)) return "no";
    return null;
  }

  const picked = savedLabel.match(/:\s*(Over|Under|Yes|No)\b/i)?.[1]?.toLowerCase();
  if (!picked) return null;

  if (picked === "yes") return canonical.direction === "yes" ? "yes" : "no";
  if (picked === "no") return canonical.direction === "no" ? "yes" : "no";
  if (picked === "over") return canonical.direction === "over" ? "yes" : "no";
  if (picked === "under") return canonical.direction === "under" ? "yes" : "no";
  return null;
}

function parlayPulse(
  bet: ManualBet,
  currentById: Map<string, MarketOpportunity>,
) {
  const linked = bet.legMarketIds.map((marketId, index) => {
    const market = currentById.get(marketId);
    const side =
      bet.legSides[index] ?? inferLegSide(market, bet.legs[index]);
    const entryPrice = bet.legEntryPriceBps[index] ?? null;
    const currentPrice = sidePrice(market, side);
    const delta =
      entryPrice !== null && currentPrice !== null
        ? currentPrice - entryPrice
        : null;
    return { marketId, market, side, entryPrice, currentPrice, delta };
  });

  const priced = linked.filter(
    (leg) =>
      leg.entryPrice !== null &&
      leg.entryPrice > 0 &&
      leg.currentPrice !== null &&
      leg.currentPrice > 0,
  );
  const up = priced.filter((leg) => (leg.delta ?? 0) >= 200).length;
  const down = priced.filter((leg) => (leg.delta ?? 0) <= -200).length;
  const steady = priced.length - up - down;

  if (!priced.length) {
    return {
      linked,
      relativePct: null as number | null,
      label: "Waiting for linked leg prices",
      detail: bet.legMarketIds.length
        ? `${bet.legMarketIds.length} linked`
        : "No linked legs",
      tone: "tracker-live-watch",
    };
  }

  const entryChance = priced.reduce(
    (product, leg) => product * ((leg.entryPrice ?? 0) / 10_000),
    1,
  );
  const currentChance = priced.reduce(
    (product, leg) => product * ((leg.currentPrice ?? 0) / 10_000),
    1,
  );
  const relativePct =
    entryChance > 0 ? ((currentChance / entryChance) - 1) * 100 : 0;

  return {
    linked,
    relativePct,
    label: `Parlay pulse ${relativePct >= 0 ? "+" : ""}${relativePct.toFixed(0)}%`,
    detail: [
      up ? `${up} up` : "",
      down ? `${down} down` : "",
      steady ? `${steady} steady` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    tone:
      relativePct >= 15
        ? "tracker-live-good"
        : relativePct <= -15
          ? "tracker-live-bad"
          : "tracker-live-watch",
  };
}

function livePulse(
  bet: ManualBet,
  current: MarketOpportunity | undefined,
) {
  if (!bet.entryPriceBps || !bet.side || !current) {
    return {
      delta: null as number | null,
      label: "Waiting for live price",
      tone: "tracker-live-watch",
    };
  }

  const currentPrice =
    bet.side === "yes" ? current.yesAskBps : current.noAskBps;
  if (currentPrice === null) {
    return {
      delta: null as number | null,
      label: "Price temporarily unavailable",
      tone: "tracker-live-watch",
    };
  }

  const delta = currentPrice - bet.entryPriceBps;
  return {
    delta,
    label: `Market pulse ${delta >= 0 ? "+" : ""}${(delta / 100).toFixed(1)}pp`,
    tone:
      delta >= 400
        ? "tracker-live-good"
        : delta <= -400
          ? "tracker-live-bad"
          : "tracker-live-watch",
  };
}

export function ManualTracker() {
  const { opportunities, refreshing } = useMarketData();
  const [bets, setBets] = useState<ManualBet[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [stake, setStake] = useState("");
  const [status, setStatus] = useState<TrackerStatus>("open");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [betType, setBetType] = useState<"straight" | "parlay">("straight");
  const [parlayLegs, setParlayLegs] = useState("");
  const [parlayLegMarketIds, setParlayLegMarketIds] = useState<string[]>([]);
  const [parlayOdds, setParlayOdds] = useState("");
  const [cashoutBetId, setCashoutBetId] = useState<string | null>(null);
  const [cashoutAmount, setCashoutAmount] = useState("");

  const realMarkets = useMemo(() => {
    const seen = new Set<string>();
    return opportunities
      .filter(
        (market) =>
          market.platform === "kalshi" &&
          market.canonical &&
          market.canonical.family !== "spread" &&
          market.executablePriceBps !== null &&
          market.recommendedSide !== null,
      )
      .toSorted(
        (a, b) =>
          Number(b.isLive) - Number(a.isLive) ||
          (b.lynervaScore ?? 0) - (a.lynervaScore ?? 0),
      )
      .filter((market) => {
        if (seen.has(market.platformMarketId)) return false;
        seen.add(market.platformMarketId);
        return true;
      });
  }, [opportunities]);

  const currentById = useMemo(
    () =>
      new Map(
        opportunities
          .filter((market) => market.platform === "kalshi")
          .map((market) => [market.platformMarketId, market]),
      ),
    [opportunities],
  );

  const selectedMarket = useMemo(
    () =>
      realMarkets.find(
        (market) => market.platformMarketId === selectedMarketId,
      ) ?? null,
    [realMarkets, selectedMarketId],
  );

  function pickMarket(nextId: string) {
    if (betType === "parlay") {
      const market = realMarkets.find(
        (candidate) => candidate.platformMarketId === nextId,
      );
      if (market && !parlayLegMarketIds.includes(nextId)) {
        const label = marketPickLabel(market);
        setParlayLegs((current) =>
          current.trim() ? `${current.trimEnd()}\n${label}` : label,
        );
        setParlayLegMarketIds((current) => [...current, nextId]);
      }
      setSelectedMarketId("");
      return;
    }
    setSelectedMarketId(nextId);
  }

  function removeParlayMarket(marketId: string) {
    const market = realMarkets.find(
      (candidate) => candidate.platformMarketId === marketId,
    );
    const label = market ? marketPickLabel(market) : null;
    setParlayLegMarketIds((current) =>
      current.filter((id) => id !== marketId),
    );
    if (label) {
      setParlayLegs((current) =>
        current
          .split("\n")
          .filter((line) => line.trim() !== label)
          .join("\n"),
      );
    }
  }

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Partial<ManualBet> & {
          platform?: "kalshi" | "polymarket";
        }>;
        setBets(
          parsed.map((bet) => ({
            id: bet.id ?? crypto.randomUUID(),
            date: bet.date ?? new Date().toISOString().slice(0, 10),
            description: bet.description ?? "Tracked bet",
            platform: "kalshi",
            stake: Number(bet.stake ?? 0),
            payout: Number(bet.payout ?? 0),
            status: (bet.status as TrackerStatus) ?? "open",
            marketId: bet.marketId ?? null,
            side: bet.side ?? null,
            entryPriceBps: bet.entryPriceBps ?? null,
            isLive: Boolean(bet.isLive),
            isParlay: Boolean(bet.isParlay),
            legs: Array.isArray(bet.legs) ? bet.legs : [],
            legMarketIds: Array.isArray(bet.legMarketIds)
              ? bet.legMarketIds
              : [],
            legSides: Array.isArray(bet.legSides) ? bet.legSides : [],
            legEntryPriceBps: Array.isArray(bet.legEntryPriceBps)
              ? bet.legEntryPriceBps
              : [],
            decimalOdds:
              typeof bet.decimalOdds === "number" ? bet.decimalOdds : null,
          })),
        );
      }

      const draftRaw = localStorage.getItem("lynerva-track-draft");
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as {
          description?: string;
          platformMarketId?: string;
        };
        setDescription(draft.description ?? "");
        setSelectedMarketId(draft.platformMarketId ?? "");
        setShowForm(true);
        localStorage.removeItem("lynerva-track-draft");
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
    } catch {}
  }, [bets]);

  useEffect(() => {
    if (!selectedMarket || betType !== "straight") return;
    setDescription(marketPickLabel(selectedMarket));
  }, [selectedMarket, betType]);

  useEffect(() => {
    if (!currentById.size) return;
    setBets((current) => {
      let changed = false;
      const next = current.map((bet) => {
        if (!bet.isParlay || !bet.legMarketIds.length) return bet;
        if (
          bet.legSides.length === bet.legMarketIds.length &&
          bet.legEntryPriceBps.length === bet.legMarketIds.length
        ) {
          return bet;
        }

        const legSides = bet.legMarketIds.map((marketId, index) => {
          const market = currentById.get(marketId);
          return (
            bet.legSides[index] ??
            inferLegSide(market, bet.legs[index]) ??
            market?.recommendedSide ??
            null
          );
        });
        const legEntryPriceBps = bet.legMarketIds.map((marketId, index) => {
          if (bet.legEntryPriceBps[index] !== undefined) {
            return bet.legEntryPriceBps[index] ?? null;
          }
          const market = currentById.get(marketId);
          return sidePrice(market, legSides[index]);
        });
        changed = true;
        return { ...bet, legSides, legEntryPriceBps };
      });
      return changed ? next : current;
    });
  }, [currentById]);

  const summary = useMemo(() => {
    const settled = bets.filter((bet) => bet.status !== "open");
    const totalRisked = settled.reduce((sum, bet) => sum + bet.stake, 0);
    const net = settled.reduce((sum, bet) => sum + (profit(bet) ?? 0), 0);
    const wins = settled.filter((bet) => bet.status === "win").length;
    const decisions = settled.filter(
      (bet) => bet.status === "win" || bet.status === "loss",
    ).length;
    const open = bets
      .filter((bet) => bet.status === "open")
      .reduce((sum, bet) => sum + bet.stake, 0);

    return {
      net,
      roi: totalRisked ? net / totalRisked : 0,
      wins,
      decisions,
      open,
      totalRisked,
    };
  }, [bets]);

  const updateStatus = (id: string, next: TrackerStatus) =>
    setBets((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        if (next === "win" && item.payout <= 0) {
          if (item.isParlay && item.decimalOdds && item.decimalOdds > 1) {
            return {
              ...item,
              status: next,
              payout: item.stake * item.decimalOdds,
            };
          }
          if (item.entryPriceBps && item.entryPriceBps > 0) {
            return {
              ...item,
              status: next,
              payout: item.stake / (item.entryPriceBps / 10_000),
            };
          }
        }
        return { ...item, status: next };
      }),
    );

  const removeBet = (id: string) =>
    setBets((current) => current.filter((item) => item.id !== id));

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const stakeValue = Number(stake);
    const legs =
      betType === "parlay"
        ? parlayLegs
            .split("\n")
            .map((leg) => leg.trim())
            .filter(Boolean)
        : [];
    const decimalOdds =
      betType === "parlay" ? parseTrackedOdds(parlayOdds) : null;
    const resolvedDescription =
      description.trim() ||
      (betType === "parlay" && legs.length
        ? `${legs.length}-leg Kalshi parlay`
        : "");

    if (
      !resolvedDescription ||
      !Number.isFinite(stakeValue) ||
      stakeValue <= 0 ||
      (betType === "parlay" && (legs.length < 2 || decimalOdds === null))
    ) {
      return;
    }

    const market = selectedMarket;
    const entryPriceBps =
      betType === "straight" ? market?.executablePriceBps ?? null : null;
    const side =
      betType === "straight" ? market?.recommendedSide ?? null : null;
    const automaticPayout =
      status === "win"
        ? entryPriceBps
          ? stakeValue / (entryPriceBps / 10_000)
          : decimalOdds
            ? stakeValue * decimalOdds
            : 0
        : 0;
    const linkedParlayMarkets =
      betType === "parlay" ? parlayLegMarketIds : [];
    const linkedParlayDetails = linkedParlayMarkets.map((marketId) =>
      realMarkets.find((candidate) => candidate.platformMarketId === marketId),
    );
    const linkedParlaySides = linkedParlayDetails.map(
      (market) => market?.recommendedSide ?? null,
    );
    const linkedParlayEntryPrices = linkedParlayDetails.map((market, index) =>
      sidePrice(market, linkedParlaySides[index]),
    );
    const parlayIsLive = linkedParlayMarkets.some((marketId) =>
      realMarkets.some(
        (candidate) =>
          candidate.platformMarketId === marketId && candidate.isLive,
      ),
    );

    setBets((current) => [
      {
        id: crypto.randomUUID(),
        date,
        description: resolvedDescription,
        platform: "kalshi",
        stake: stakeValue,
        payout: automaticPayout,
        status,
        marketId:
          betType === "straight" ? market?.platformMarketId ?? null : null,
        side,
        entryPriceBps,
        isLive:
          betType === "straight" ? Boolean(market?.isLive) : parlayIsLive,
        isParlay: betType === "parlay",
        legs,
        legMarketIds: linkedParlayMarkets,
        legSides: linkedParlaySides,
        legEntryPriceBps: linkedParlayEntryPrices,
        decimalOdds,
      },
      ...current,
    ]);

    setDescription("");
    setStake("");
    setStatus("open");
    setSelectedMarketId("");
    setParlayLegs("");
    setParlayLegMarketIds([]);
    setParlayOdds("");
    setBetType("straight");
    setShowForm(false);
  };

  const confirmCashout = () => {
    const amount = Number(cashoutAmount);
    if (!cashoutBetId || !Number.isFinite(amount) || amount < 0) return;
    setBets((current) =>
      current.map((bet) =>
        bet.id === cashoutBetId
          ? { ...bet, status: "cashed", payout: amount }
          : bet,
      ),
    );
    setCashoutBetId(null);
    setCashoutAmount("");
  };

  const inputClass =
    "control-surface h-11 w-full rounded-xl px-3 text-xs outline-none transition-colors focus:border-accent";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        {[
          ["Net P/L", money(summary.net), summary.net],
          ["ROI", `${(summary.roi * 100).toFixed(1)}%`, summary.roi],
          [
            "Win rate",
            summary.decisions
              ? `${Math.round((summary.wins / summary.decisions) * 100)}%`
              : "n/a",
            0,
          ],
          ["Settled risk", money(summary.totalRisked), 0],
          ["Open risk", money(summary.open), 0],
        ].map(([label, value, numeric], index) => (
          <div
            key={String(label)}
            className={cn(
              "premium-panel rounded-2xl p-3.5 sm:p-4",
              index === 4 ? "col-span-2 lg:col-span-1" : "",
            )}
          >
            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint sm:text-[10px]">
              {label}
            </div>
            <div
              className={cn(
                "mt-2 text-lg font-bold tabular sm:text-xl",
                Number(numeric) > 0
                  ? "text-positive"
                  : Number(numeric) < 0
                    ? "text-negative"
                    : "",
              )}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b bg-[radial-gradient(circle_at_10%_0%,var(--accent-bg),transparent_46%),var(--surface-raised)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-accent" />
              <h2 className="font-semibold">Position tracker</h2>
              {refreshing ? (
                <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[8px] font-semibold text-accent">
                  Updating live prices
                </span>
              ) : null}
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Pick a real Kalshi market for a straight, or autofill Kalshi legs
              into a parlay and enter the exact total odds you actually got.
              Linked open straight bets get a live market pulse from current
              pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="primary-action inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold sm:w-auto"
          >
            <Plus size={14} />
            {showForm ? "Close" : "Add position"}
          </button>
        </div>

        {showForm ? (
          <form
            onSubmit={add}
            className="grid gap-3 border-b bg-background/45 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-6"
          >
            <div className="sm:col-span-2 lg:col-span-3">
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                {betType === "parlay"
                  ? "Add a leg from current Kalshi markets"
                  : "Autofill from current Kalshi markets"}
              </span>
              <MarketPicker
                markets={realMarkets}
                selectedMarketId={selectedMarketId}
                excludedIds={betType === "parlay" ? parlayLegMarketIds : []}
                mode={betType}
                onPick={pickMarket}
              />
              {betType === "straight" && selectedMarket ? (
                <SelectedMarketCard market={selectedMarket} />
              ) : null}
              {betType === "parlay" && parlayLegMarketIds.length ? (
                <div className="mt-2 space-y-2">
                  {parlayLegMarketIds.map((marketId) => {
                    const market = realMarkets.find(
                      (candidate) => candidate.platformMarketId === marketId,
                    );
                    return market ? (
                      <SelectedMarketCard
                        key={marketId}
                        market={market}
                        onRemove={() => removeParlayMarket(marketId)}
                      />
                    ) : null;
                  })}
                </div>
              ) : null}
            </div>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Bet type
              </span>
              <select
                value={betType}
                onChange={(event) => {
                  const next = event.target.value as "straight" | "parlay";
                  setBetType(next);
                  setSelectedMarketId("");
                }}
                className={inputClass}
              >
                <option value="straight">Straight</option>
                <option value="parlay">Parlay</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Stake
              </span>
              <div className="control-surface flex h-11 items-center rounded-xl px-3">
                <span className="text-xs text-muted">$</span>
                <input
                  value={stake}
                  onChange={(event) => setStake(event.target.value)}
                  required
                  inputMode="decimal"
                  className="w-full bg-transparent pl-1 text-xs outline-none"
                />
              </div>
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Date
              </span>
              <input
                value={date}
                onChange={(event) => setDate(event.target.value)}
                type="date"
                className={inputClass}
              />
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Starting status
              </span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TrackerStatus)
                }
                className={inputClass}
              >
                <option value="open">Open</option>
                <option value="win">Won</option>
                <option value="loss">Lost</option>
                <option value="push">Push / void</option>
              </select>
            </label>

            <label className="sm:col-span-2 lg:col-span-4">
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Description
              </span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required={betType === "straight"}
                className={inputClass}
                placeholder={
                  betType === "parlay"
                    ? "Optional name, e.g. Sunday 4-leg parlay"
                    : "Saquon Barkley over 72.5 rushing yards"
                }
              />
            </label>

            {betType === "parlay" ? (
              <>
                <label className="sm:col-span-2 lg:col-span-4">
                  <span className="mb-1.5 block text-[10px] font-medium text-muted">
                    Parlay legs
                    {parlayLegMarketIds.length
                      ? ` · ${parlayLegMarketIds.length} autofilled`
                      : ""}
                  </span>
                  <textarea
                    value={parlayLegs}
                    onChange={(event) => setParlayLegs(event.target.value)}
                    rows={4}
                    className="control-surface w-full rounded-xl px-3 py-2.5 text-xs outline-none focus:border-accent"
                    placeholder={"Use the dropdown above to add Kalshi legs, or type them here\nLeg 2\nLeg 3"}
                  />
                </label>

                <label className="sm:col-span-2 lg:col-span-2">
                  <span className="mb-1.5 block text-[10px] font-medium text-muted">
                    Your total parlay odds
                  </span>
                  <input
                    value={parlayOdds}
                    onChange={(event) => setParlayOdds(event.target.value)}
                    required
                    className={inputClass}
                    placeholder="+450 or 5.50x"
                    inputMode="decimal"
                  />
                  <span className="mt-1.5 block text-[9px] leading-4 text-faint">
                    Use the odds you actually received. Lynerva uses this exact
                    price for win payout and P/L.
                  </span>
                </label>
              </>
            ) : null}

            <div className="sm:col-span-2 lg:col-span-2 lg:flex lg:items-end lg:justify-end">
              <button className="primary-action h-11 w-full rounded-xl px-5 text-xs font-semibold lg:w-auto">
                Save position
              </button>
            </div>
          </form>
        ) : null}

        {!bets.length ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid size-10 place-items-center rounded-xl border bg-surface-raised">
              <Activity className="size-4 text-muted" />
            </div>
            <p className="mt-3 font-medium">Nothing tracked yet</p>
            <p className="mt-1 text-xs text-muted">
              Add a real Kalshi market above, or send a pick here from Bet Lab.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
            {bets.map((bet) => {
              const current = bet.marketId
                ? currentById.get(bet.marketId)
                : undefined;
              const pulse = livePulse(bet, current);
              const parlay = bet.isParlay ? parlayPulse(bet, currentById) : null;
              const isLinkedOpen =
                bet.status === "open" && Boolean(bet.marketId);
              const isLinkedParlayOpen =
                bet.status === "open" &&
                bet.isParlay &&
                bet.legMarketIds.length > 0;
              const liveControls =
                bet.status === "open" &&
                (bet.isLive || Boolean(current?.isLive));
              const pl = profit(bet);

              return (
                <article
                  key={bet.id}
                  className={cn(
                    "tracker-card rounded-2xl border bg-surface p-4",
                    isLinkedOpen
                      ? pulse.tone
                      : isLinkedParlayOpen
                        ? parlay?.tone
                        : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.07em]",
                          statusTone(bet.status),
                        )}>
                          {bet.status === "cashed"
                            ? "Cashed out"
                            : bet.status}
                        </span>
                        {bet.isParlay ? (
                          <span className="rounded-full border bg-accent-bg px-2 py-0.5 text-[8px] font-semibold text-accent">
                            Parlay
                          </span>
                        ) : null}
                        {isLinkedOpen ? (
                          <span className="rounded-full border bg-background px-2 py-0.5 text-[8px] font-semibold text-muted">
                            {pulse.label}
                          </span>
                        ) : isLinkedParlayOpen && parlay ? (
                          <span className="rounded-full border bg-background px-2 py-0.5 text-[8px] font-semibold text-muted">
                            {parlay.label}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-5">
                        {bet.isParlay
                          ? `${bet.legs.length}-leg parlay`
                          : bet.description}
                      </p>
                      {bet.isParlay &&
                      bet.description &&
                      bet.description !== `${bet.legs.length}-leg Kalshi parlay` &&
                      bet.description !== bet.legs[0] ? (
                        <p className="mt-0.5 truncate text-[10px] text-muted">
                          {bet.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-faint">
                        {bet.date} · Kalshi
                        {bet.entryPriceBps
                          ? ` · entry ${formatPercent(bet.entryPriceBps)}`
                          : ""}
                        {bet.isParlay && trackedOddsLabel(bet.decimalOdds)
                          ? ` · ${trackedOddsLabel(bet.decimalOdds)}`
                          : ""}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeBet(bet.id)}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-negative-bg hover:text-negative"
                      aria-label="Delete position"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {bet.isParlay && bet.status === "open" ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          Stake
                        </p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {money(bet.stake)}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          To return
                        </p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {bet.decimalOdds
                            ? money(bet.stake * bet.decimalOdds)
                            : "n/a"}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          Live pulse
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-xs font-semibold tabular",
                            (parlay?.relativePct ?? 0) > 0
                              ? "text-positive"
                              : (parlay?.relativePct ?? 0) < 0
                                ? "text-negative"
                                : "",
                          )}
                        >
                          {parlay?.relativePct === null ||
                          parlay?.relativePct === undefined
                            ? "waiting"
                            : `${parlay.relativePct >= 0 ? "+" : ""}${parlay.relativePct.toFixed(0)}%`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          Stake
                        </p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {money(bet.stake)}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          Returned
                        </p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {bet.status === "open" || bet.status === "loss"
                            ? "n/a"
                            : money(bet.payout)}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-background p-2.5">
                        <p className="text-[8px] uppercase tracking-[0.07em] text-faint">
                          P/L
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-xs font-semibold tabular",
                            (pl ?? 0) > 0
                              ? "text-positive"
                              : (pl ?? 0) < 0
                                ? "text-negative"
                                : "",
                          )}
                        >
                          {money(pl)}
                        </p>
                      </div>
                    </div>
                  )}

                  {bet.isParlay && bet.legs.length ? (
                    <details className="group mt-3 rounded-xl border bg-background">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[10px] font-semibold">
                        <span>
                          {bet.legs.length} parlay legs
                          {bet.legMarketIds.length
                            ? ` · ${bet.legMarketIds.length} linked`
                            : ""}
                        </span>
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t px-3 py-2.5">
                        {bet.status === "open" && parlay?.detail ? (
                          <div className="mb-2 text-[9px] font-medium text-faint">
                            {parlay.detail}
                          </div>
                        ) : null}
                        <ol className="space-y-2 text-[10px] leading-4 text-muted">
                          {bet.legs.map((leg, index) => {
                            const linkedLeg = parlay?.linked[index];
                            const delta = linkedLeg?.delta ?? null;
                            return (
                              <li
                                key={`${bet.id}:${index}`}
                                className="flex items-center gap-2"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="mr-2 text-faint">
                                    {index + 1}.
                                  </span>
                                  {leg}
                                </span>
                                {delta !== null ? (
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tabular",
                                      delta >= 200
                                        ? "border-positive/25 bg-positive-bg text-positive"
                                        : delta <= -200
                                          ? "border-negative/25 bg-negative-bg text-negative"
                                          : "bg-surface text-muted",
                                    )}
                                  >
                                    {delta >= 0 ? "+" : ""}
                                    {(delta / 100).toFixed(1)}pp
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </details>
                  ) : null}

                  {liveControls ? (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => updateStatus(bet.id, "win")}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-positive/25 bg-positive-bg text-[10px] font-semibold text-positive"
                      >
                        <CheckCircle2 size={12} />
                        Hit
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(bet.id, "loss")}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-negative/25 bg-negative-bg text-[10px] font-semibold text-negative"
                      >
                        <XCircle size={12} />
                        Didn&apos;t
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCashoutBetId(bet.id);
                          setCashoutAmount("");
                        }}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-accent/25 bg-accent-bg text-[10px] font-semibold text-accent"
                      >
                        <CircleDollarSign size={12} />
                        Cashed
                      </button>
                    </div>
                  ) : bet.status === "open" ? (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[9px] text-faint">
                        Settle when the market closes
                      </span>
                      <select
                        value={bet.status}
                        onChange={(event) =>
                          updateStatus(
                            bet.id,
                            event.target.value as TrackerStatus,
                          )
                        }
                        className="h-8 rounded-lg border bg-background px-2 text-[10px]"
                      >
                        <option value="open">Open</option>
                        <option value="win">Won</option>
                        <option value="loss">Lost</option>
                        <option value="push">Push / void</option>
                      </select>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {cashoutBetId ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[var(--overlay)] p-4">
          <div className="premium-panel w-full max-w-sm rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="size-4 text-accent" />
              <h3 className="text-sm font-semibold">Cashout amount</h3>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              Enter the total amount returned to you when you cashed out. Lynerva
              will use it to calculate realized P/L.
            </p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Amount returned
              </span>
              <div className="control-surface flex h-11 items-center rounded-xl px-3">
                <span className="text-xs text-muted">$</span>
                <input
                  autoFocus
                  value={cashoutAmount}
                  onChange={(event) => setCashoutAmount(event.target.value)}
                  inputMode="decimal"
                  className="w-full bg-transparent pl-1 text-sm outline-none"
                />
              </div>
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setCashoutBetId(null);
                  setCashoutAmount("");
                }}
                className="h-10 rounded-xl border bg-surface text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCashout}
                className="primary-action h-10 rounded-xl text-xs font-semibold"
              >
                Save cashout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
