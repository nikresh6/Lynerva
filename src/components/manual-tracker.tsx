"use client";

import {
  Banknote,
  Plus,
  Radio,
  RotateCcw,
  Trash2,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent } from "@/lib/utils";
import { useMarketData } from "./market-data-provider";

type BetStatus = "open" | "win" | "loss" | "cashed_out";

interface ManualBet {
  id: string;
  date: string;
  description: string;
  platform: "kalshi";
  stake: number;
  payout: number;
  status: BetStatus;
  cashoutAmount?: number;
  entryPriceBps?: number | null;
  platformMarketId?: string | null;
  platformOutcomeId?: string | null;
  canonicalKey?: string | null;
}

type DraftLink = Pick<
  ManualBet,
  | "entryPriceBps"
  | "platformMarketId"
  | "platformOutcomeId"
  | "canonicalKey"
>;

const STORAGE_KEY = "lynerva-manual-tracker-v2";
const LEGACY_STORAGE_KEY = "lynerva-manual-tracker-v1";

function normalizeStoredBet(raw: Record<string, unknown>): ManualBet | null {
  const stake = Number(raw.stake);
  if (!raw.id || !raw.description || !Number.isFinite(stake) || stake <= 0) {
    return null;
  }
  const rawStatus = String(raw.status ?? "open");
  const status: BetStatus =
    rawStatus === "win" ||
    rawStatus === "loss" ||
    rawStatus === "cashed_out"
      ? rawStatus
      : rawStatus === "push"
        ? "cashed_out"
        : "open";
  return {
    id: String(raw.id),
    date: String(raw.date ?? new Date().toISOString().slice(0, 10)),
    description: String(raw.description),
    platform: "kalshi",
    stake,
    payout: Number(raw.payout ?? 0) || 0,
    status,
    cashoutAmount:
      rawStatus === "push"
        ? stake
        : raw.cashoutAmount === undefined
          ? undefined
          : Number(raw.cashoutAmount),
    entryPriceBps:
      raw.entryPriceBps === undefined || raw.entryPriceBps === null
        ? null
        : Number(raw.entryPriceBps),
    platformMarketId:
      raw.platformMarketId === undefined || raw.platformMarketId === null
        ? null
        : String(raw.platformMarketId),
    platformOutcomeId:
      raw.platformOutcomeId === undefined || raw.platformOutcomeId === null
        ? null
        : String(raw.platformOutcomeId),
    canonicalKey:
      raw.canonicalKey === undefined || raw.canonicalKey === null
        ? null
        : String(raw.canonicalKey),
  };
}

function profit(bet: ManualBet) {
  if (bet.status === "open") return null;
  if (bet.status === "loss") return -bet.stake;
  if (bet.status === "cashed_out") {
    return (bet.cashoutAmount ?? 0) - bet.stake;
  }
  return bet.payout - bet.stake;
}

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function linkedMarket(
  bet: ManualBet,
  markets: MarketOpportunity[],
): MarketOpportunity | null {
  if (bet.platformMarketId) {
    const exact = markets.find(
      (market) =>
        market.platformMarketId === bet.platformMarketId &&
        (!bet.platformOutcomeId ||
          market.platformOutcomeId === bet.platformOutcomeId),
    );
    if (exact) return exact;
  }
  if (bet.canonicalKey) {
    return (
      markets.find((market) => market.canonical?.key === bet.canonicalKey) ??
      null
    );
  }
  return null;
}

function liveTone(market: MarketOpportunity | null) {
  if (!market?.isLive) return "neutral" as const;
  const chance =
    market.recommendedProbabilityBps ?? market.executablePriceBps ?? 5_000;
  if (chance >= 7_000) return "good" as const;
  if (chance <= 3_500) return "bad" as const;
  return "watch" as const;
}

function statusLabel(bet: ManualBet) {
  if (bet.status === "win") return "Won";
  if (bet.status === "loss") return "Lost";
  if (bet.status === "cashed_out") return "Cashed out";
  return "Open";
}

export function ManualTracker() {
  const { opportunities } = useMarketData();
  const [bets, setBets] = useState<ManualBet[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [stake, setStake] = useState("");
  const [payout, setPayout] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftLink, setDraftLink] = useState<DraftLink | null>(null);
  const [cashoutBetId, setCashoutBetId] = useState<string | null>(null);
  const [cashoutInput, setCashoutInput] = useState("");

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setBets(
            parsed
              .map((item) =>
                item && typeof item === "object"
                  ? normalizeStoredBet(item as Record<string, unknown>)
                  : null,
              )
              .filter((item): item is ManualBet => Boolean(item)),
          );
        }
      }

      const draftRaw = localStorage.getItem("lynerva-track-draft");
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as {
          description?: string;
          entryPriceBps?: number | null;
          platformMarketId?: string | null;
          platformOutcomeId?: string | null;
          canonicalKey?: string | null;
        };
        setDescription(draft.description ?? "");
        setDraftLink({
          entryPriceBps: draft.entryPriceBps ?? null,
          platformMarketId: draft.platformMarketId ?? null,
          platformOutcomeId: draft.platformOutcomeId ?? null,
          canonicalKey: draft.canonicalKey ?? null,
        });
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

  const settleWin = (bet: ManualBet) => {
    const impliedGross =
      bet.entryPriceBps && bet.entryPriceBps > 0
        ? bet.stake / (bet.entryPriceBps / 10_000)
        : bet.payout || bet.stake;
    setBets((current) =>
      current.map((item) =>
        item.id === bet.id
          ? { ...item, status: "win", payout: item.payout || impliedGross }
          : item,
      ),
    );
  };

  const settleLoss = (id: string) =>
    setBets((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "loss", payout: 0 } : item,
      ),
    );

  const reopen = (id: string) =>
    setBets((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "open" } : item,
      ),
    );

  const removeBet = (id: string) =>
    setBets((current) => current.filter((item) => item.id !== id));

  const completeCashout = () => {
    const value = Number(cashoutInput);
    if (!cashoutBetId || !Number.isFinite(value) || value < 0) return;
    setBets((current) =>
      current.map((item) =>
        item.id === cashoutBetId
          ? {
              ...item,
              status: "cashed_out",
              cashoutAmount: value,
              payout: value,
            }
          : item,
      ),
    );
    setCashoutBetId(null);
    setCashoutInput("");
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const stakeValue = Number(stake);
    const payoutValue = Number(payout || 0);
    if (
      !description.trim() ||
      !Number.isFinite(stakeValue) ||
      stakeValue <= 0
    ) {
      return;
    }

    setBets((current) => [
      {
        id: crypto.randomUUID(),
        date,
        description: description.trim(),
        platform: "kalshi",
        stake: stakeValue,
        payout: Number.isFinite(payoutValue) ? payoutValue : 0,
        status: "open",
        ...draftLink,
      },
      ...current,
    ]);
    setDescription("");
    setStake("");
    setPayout("");
    setDraftLink(null);
    setShowForm(false);
  };

  const inputClass =
    "control-surface h-11 w-full rounded-xl px-3 text-xs outline-none transition-colors focus:border-accent";

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-5 lg:gap-3">
        {[
          [
            "Net P/L",
            money(summary.net),
            summary.net > 0 ? "positive" : summary.net < 0 ? "negative" : "",
          ],
          [
            "ROI",
            `${(summary.roi * 100).toFixed(1)}%`,
            summary.roi > 0 ? "positive" : summary.roi < 0 ? "negative" : "",
          ],
          [
            "Win rate",
            summary.decisions
              ? `${Math.round((summary.wins / summary.decisions) * 100)}%`
              : "—",
            "",
          ],
          ["Settled risk", money(summary.totalRisked), ""],
          ["Open risk", money(summary.open), ""],
        ].map(([label, value, tone], index) => (
          <div
            key={label}
            className={cn(
              "premium-panel relative overflow-hidden rounded-2xl p-3.5 sm:p-4",
              index === 4 ? "col-span-2 lg:col-span-1" : "",
            )}
          >
            <div
              className={cn(
                "absolute inset-x-0 top-0 h-0.5",
                tone === "positive"
                  ? "bg-positive"
                  : tone === "negative"
                    ? "bg-negative"
                    : "bg-border-strong",
              )}
            />
            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint sm:text-[10px]">
              {label}
            </div>
            <div
              className={cn(
                "mt-2 text-lg font-bold tabular sm:text-xl",
                tone === "positive"
                  ? "text-positive"
                  : tone === "negative"
                    ? "text-negative"
                    : "",
              )}
            >
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b bg-[linear-gradient(120deg,var(--surface-raised),var(--surface))] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Bet tracker</h2>
              <span className="rounded-full border bg-background px-2 py-0.5 text-[9px] font-medium text-faint">
                Kalshi
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Track entries manually. Bets opened from Bet Lab keep their market
              identity, so live cards can show how the position is moving.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="primary-action inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold sm:w-auto"
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? "Close" : "Add bet"}
          </button>
        </div>

        {showForm ? (
          <form
            onSubmit={add}
            className="grid gap-3 border-b bg-background/45 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]"
          >
            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Bet
              </span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                className={inputClass}
                placeholder="Over 64.5 rushing yards"
              />
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
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-full bg-transparent pl-1 text-xs outline-none"
                />
              </div>
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Win payout
              </span>
              <div className="control-surface flex h-11 items-center rounded-xl px-3">
                <span className="text-xs text-muted">$</span>
                <input
                  value={payout}
                  onChange={(event) => setPayout(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full bg-transparent pl-1 text-xs outline-none"
                  placeholder="Optional"
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
            <div className="flex items-end">
              <button className="primary-action h-11 w-full rounded-xl px-5 text-xs font-semibold">
                Save
              </button>
            </div>
          </form>
        ) : null}

        {!bets.length ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">No bets tracked yet.</p>
            <p className="mt-1 text-xs text-muted">
              Add one here, or use Track this bet from Bet Lab.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
            {bets.map((bet) => {
              const market = linkedMarket(bet, opportunities);
              const tone = bet.status === "open" ? liveTone(market) : "neutral";
              const pl = profit(bet);
              const chance =
                market?.recommendedProbabilityBps ??
                market?.executablePriceBps ??
                null;
              return (
                <article
                  key={bet.id}
                  className={cn(
                    "tracker-position-card relative overflow-hidden rounded-2xl border bg-surface p-4 transition-colors sm:p-5",
                    tone === "good"
                      ? "tracker-live-good"
                      : tone === "bad"
                        ? "tracker-live-bad"
                        : tone === "watch"
                          ? "tracker-live-watch"
                          : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">
                          {bet.date}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                            bet.status === "win"
                              ? "bg-positive-bg text-positive"
                              : bet.status === "loss"
                                ? "bg-negative-bg text-negative"
                                : bet.status === "cashed_out"
                                  ? "bg-warning-bg text-warning"
                                  : "bg-background text-muted",
                          )}
                        >
                          {statusLabel(bet)}
                        </span>
                        {bet.status === "open" && market?.isLive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-negative-bg px-2 py-0.5 text-[9px] font-semibold text-negative">
                            <Radio size={9} className="animate-pulse" />
                            Live
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold leading-5 sm:text-base">
                        {bet.description}
                      </h3>
                      {bet.status === "open" && market ? (
                        <p className="mt-1 text-[10px] text-muted">
                          Current Lynerva chance{" "}
                          <span
                            className={cn(
                              "font-semibold",
                              tone === "good"
                                ? "text-positive"
                                : tone === "bad"
                                  ? "text-negative"
                                  : tone === "watch"
                                    ? "text-warning"
                                    : "text-foreground",
                            )}
                          >
                            {formatPercent(chance)}
                          </span>
                          {market.isLive ? " · updating with the live market" : ""}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBet(bet.id)}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-negative-bg hover:text-negative"
                      aria-label="Delete bet"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border bg-background/70 p-3">
                      <div className="text-[9px] text-faint">Stake</div>
                      <div className="mt-1 text-sm font-semibold tabular">
                        {money(bet.stake)}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-background/70 p-3">
                      <div className="text-[9px] text-faint">
                        {bet.status === "cashed_out" ? "Cash out" : "Payout"}
                      </div>
                      <div className="mt-1 text-sm font-semibold tabular">
                        {bet.status === "win"
                          ? money(bet.payout)
                          : bet.status === "cashed_out"
                            ? money(bet.cashoutAmount ?? 0)
                            : "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border bg-background/70 p-3">
                      <div className="text-[9px] text-faint">P/L</div>
                      <div
                        className={cn(
                          "mt-1 text-sm font-semibold tabular",
                          (pl ?? 0) > 0
                            ? "text-positive"
                            : (pl ?? 0) < 0
                              ? "text-negative"
                              : "",
                        )}
                      >
                        {money(pl)}
                      </div>
                    </div>
                  </div>

                  {bet.status === "open" ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => settleWin(bet)}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-positive/25 bg-positive-bg text-[11px] font-semibold text-positive transition-transform active:scale-[0.98]"
                      >
                        <Trophy size={13} /> Win
                      </button>
                      <button
                        type="button"
                        onClick={() => settleLoss(bet.id)}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-negative/25 bg-negative-bg text-[11px] font-semibold text-negative transition-transform active:scale-[0.98]"
                      >
                        <XCircle size={13} /> Lost
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCashoutBetId(bet.id);
                          setCashoutInput("");
                        }}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border bg-background text-[11px] font-semibold transition-colors hover:bg-surface-raised"
                      >
                        <Banknote size={13} /> Cash out
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          (pl ?? 0) > 0
                            ? "text-positive"
                            : (pl ?? 0) < 0
                              ? "text-negative"
                              : "text-muted",
                        )}
                      >
                        {pl === null
                          ? ""
                          : `${pl >= 0 ? "+" : ""}${money(pl)} result`}
                      </span>
                      <button
                        type="button"
                        onClick={() => reopen(bet.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-muted hover:bg-background hover:text-foreground"
                      >
                        <RotateCcw size={11} /> Reopen
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {cashoutBetId ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Record cash out"
        >
          <button
            type="button"
            className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]"
            onClick={() => setCashoutBetId(null)}
            aria-label="Close cash out"
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border bg-surface p-5 shadow-[0_28px_100px_rgb(0_0_0/0.5)]">
            <div className="flex items-center gap-2">
              <Banknote size={16} />
              <h3 className="font-semibold">How much did you cash out for?</h3>
            </div>
            <div className="control-surface mt-4 flex h-12 items-center rounded-xl px-3">
              <span className="text-sm text-muted">$</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={cashoutInput}
                onChange={(event) => setCashoutInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") completeCashout();
                }}
                className="w-full bg-transparent pl-1 text-base outline-none tabular"
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCashoutBetId(null)}
                className="h-10 rounded-xl border text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={completeCashout}
                className="primary-action h-10 rounded-xl text-xs font-semibold"
              >
                Save cash out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
