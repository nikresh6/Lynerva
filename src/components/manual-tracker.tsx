"use client";

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent } from "@/lib/utils";
import { useMarketData } from "./market-data-provider";

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

function statusTone(status: TrackerStatus) {
  if (status === "win") return "bg-positive-bg text-positive";
  if (status === "loss") return "bg-negative-bg text-negative";
  if (status === "cashed") return "bg-accent-bg text-accent";
  if (status === "push") return "bg-warning-bg text-warning";
  return "bg-background text-muted";
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
  const [cashoutBetId, setCashoutBetId] = useState<string | null>(null);
  const [cashoutAmount, setCashoutAmount] = useState("");

  const realMarkets = useMemo(() => {
    const seen = new Set<string>();
    return opportunities
      .filter(
        (market) =>
          market.platform === "kalshi" &&
          market.canonical &&
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
      })
      .slice(0, 250);
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
    if (!selectedMarket) return;
    setDescription(marketPickLabel(selectedMarket));
    setBetType("straight");
  }, [selectedMarket]);

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
        if (
          next === "win" &&
          item.payout <= 0 &&
          item.entryPriceBps &&
          item.entryPriceBps > 0
        ) {
          return {
            ...item,
            status: next,
            payout: item.stake / (item.entryPriceBps / 10_000),
          };
        }
        return { ...item, status: next };
      }),
    );

  const removeBet = (id: string) =>
    setBets((current) => current.filter((item) => item.id !== id));

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const stakeValue = Number(stake);
    if (
      !description.trim() ||
      !Number.isFinite(stakeValue) ||
      stakeValue <= 0
    ) {
      return;
    }

    const market = selectedMarket;
    const entryPriceBps =
      betType === "straight" ? market?.executablePriceBps ?? null : null;
    const side =
      betType === "straight" ? market?.recommendedSide ?? null : null;
    const automaticPayout =
      status === "win" && entryPriceBps
        ? stakeValue / (entryPriceBps / 10_000)
        : 0;

    setBets((current) => [
      {
        id: crypto.randomUUID(),
        date,
        description: description.trim(),
        platform: "kalshi",
        stake: stakeValue,
        payout: automaticPayout,
        status,
        marketId:
          betType === "straight" ? market?.platformMarketId ?? null : null,
        side,
        entryPriceBps,
        isLive: Boolean(market?.isLive),
        isParlay: betType === "parlay",
        legs:
          betType === "parlay"
            ? parlayLegs
                .split("\n")
                .map((leg) => leg.trim())
                .filter(Boolean)
            : [],
      },
      ...current,
    ]);

    setDescription("");
    setStake("");
    setStatus("open");
    setSelectedMarketId("");
    setParlayLegs("");
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
              Pick a real Kalshi market for autofill, or enter a manual straight
              or parlay. Linked open bets get a live market pulse from current
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
            <label className="sm:col-span-2 lg:col-span-3">
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Autofill from current Kalshi markets
              </span>
              <select
                value={selectedMarketId}
                onChange={(event) => setSelectedMarketId(event.target.value)}
                disabled={betType === "parlay"}
                className={inputClass}
              >
                <option value="">Manual entry</option>
                {realMarkets.map((market) => (
                  <option
                    key={market.platformMarketId}
                    value={market.platformMarketId}
                  >
                    {market.isLive ? "LIVE | " : ""}
                    {marketPickLabel(market)} |{" "}
                    {formatPercent(market.executablePriceBps)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Bet type
              </span>
              <select
                value={betType}
                onChange={(event) => {
                  const next = event.target.value as "straight" | "parlay";
                  setBetType(next);
                  if (next === "parlay") setSelectedMarketId("");
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
                required
                className={inputClass}
                placeholder="Saquon Barkley over 72.5 rushing yards"
              />
            </label>

            {betType === "parlay" ? (
              <label className="sm:col-span-2 lg:col-span-4">
                <span className="mb-1.5 block text-[10px] font-medium text-muted">
                  Parlay legs, one per line
                </span>
                <textarea
                  value={parlayLegs}
                  onChange={(event) => setParlayLegs(event.target.value)}
                  rows={4}
                  className="control-surface w-full rounded-xl px-3 py-2.5 text-xs outline-none focus:border-accent"
                  placeholder={"Leg 1\nLeg 2\nLeg 3"}
                />
              </label>
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
              const isLinkedOpen =
                bet.status === "open" && Boolean(bet.marketId);
              const liveControls =
                bet.status === "open" &&
                (bet.isLive || Boolean(current?.isLive));
              const pl = profit(bet);

              return (
                <article
                  key={bet.id}
                  className={cn(
                    "tracker-card rounded-2xl border bg-surface p-4",
                    isLinkedOpen ? pulse.tone : "",
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
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-5">
                        {bet.description}
                      </p>
                      <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-faint">
                        {bet.date} · Kalshi
                        {bet.entryPriceBps
                          ? ` · entry ${formatPercent(bet.entryPriceBps)}`
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

                  {bet.isParlay && bet.legs.length ? (
                    <details className="group mt-3 rounded-xl border bg-background">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[10px] font-semibold">
                        <span>{bet.legs.length} parlay legs</span>
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t px-3 py-2.5">
                        <ol className="space-y-1.5 text-[10px] leading-4 text-muted">
                          {bet.legs.map((leg, index) => (
                            <li key={`${bet.id}:${index}`}>
                              <span className="mr-2 text-faint">
                                {index + 1}.
                              </span>
                              {leg}
                            </li>
                          ))}
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
