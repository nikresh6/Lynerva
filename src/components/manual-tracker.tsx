"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface ManualBet {
  id: string;
  date: string;
  description: string;
  platform: "kalshi" | "polymarket";
  stake: number;
  payout: number;
  status: "open" | "win" | "loss" | "push";
}

const STORAGE_KEY = "lynerva-manual-tracker-v1";

function profit(bet: ManualBet) {
  if (bet.status === "open") return null;
  if (bet.status === "loss") return -bet.stake;
  if (bet.status === "push") return 0;
  return bet.payout - bet.stake;
}

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function resultTone(status: ManualBet["status"]) {
  if (status === "win") return "bg-positive-bg text-positive";
  if (status === "loss") return "bg-negative-bg text-negative";
  return "bg-background text-muted";
}

export function ManualTracker() {
  const [bets, setBets] = useState<ManualBet[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<ManualBet["platform"]>("kalshi");
  const [stake, setStake] = useState("");
  const [payout, setPayout] = useState("");
  const [status, setStatus] = useState<ManualBet["status"]>("open");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBets(JSON.parse(raw));

      const draftRaw = localStorage.getItem("lynerva-track-draft");
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as {
          description?: string;
          platform?: ManualBet["platform"];
        };
        setDescription(draft.description ?? "");
        setPlatform(draft.platform ?? "kalshi");
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

  const updateStatus = (id: string, next: ManualBet["status"]) =>
    setBets((current) =>
      current.map((item) => (item.id === id ? { ...item, status: next } : item)),
    );

  const updatePayout = (id: string, value: number) =>
    setBets((current) =>
      current.map((item) =>
        item.id === id ? { ...item, payout: value } : item,
      ),
    );

  const removeBet = (id: string) =>
    setBets((current) => current.filter((item) => item.id !== id));

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
        platform,
        stake: stakeValue,
        payout: payoutValue,
        status,
      },
      ...current,
    ]);
    setDescription("");
    setStake("");
    setPayout("");
    setStatus("open");
    setShowForm(false);
  };

  const inputClass =
    "control-surface h-11 w-full rounded-xl px-3 text-xs outline-none transition-colors focus:border-accent";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5">
        {[
          [
            "Net P/L",
            money(summary.net),
            summary.net > 0
              ? "positive"
              : summary.net < 0
                ? "negative"
                : "",
          ],
          [
            "ROI",
            `${(summary.roi * 100).toFixed(1)}%`,
            summary.roi > 0
              ? "positive"
              : summary.roi < 0
                ? "negative"
                : "",
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
      </div>

      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b bg-surface-raised/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="font-semibold">Manual bet log</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              Nothing is connected to a betting account. You enter positions
              and results yourself.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="primary-action inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold sm:w-auto"
          >
            <Plus size={14} />
            {showForm ? "Close form" : "Add bet"}
          </button>
        </div>

        {showForm ? (
          <form
            onSubmit={add}
            className="grid gap-3 border-b bg-background/40 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-6"
          >
            <label className="sm:col-span-2 lg:col-span-2">
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Bet
              </span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                className={inputClass}
                placeholder="Bills moneyline"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Platform
              </span>
              <select
                value={platform}
                onChange={(event) =>
                  setPlatform(event.target.value as ManualBet["platform"])
                }
                className={inputClass}
              >
                <option value="kalshi">Kalshi</option>
                <option value="polymarket">Polymarket</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Stake ($)
              </span>
              <input
                value={stake}
                onChange={(event) => setStake(event.target.value)}
                required
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
              />
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Result
              </span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ManualBet["status"])
                }
                className={inputClass}
              >
                <option value="open">Open</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="push">Push / void</option>
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-[10px] font-medium text-muted">
                Payout ($)
              </span>
              <input
                value={payout}
                onChange={(event) => setPayout(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="For wins"
              />
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

            <div className="sm:col-span-2 lg:col-span-5 lg:flex lg:items-end">
              <button className="primary-action h-11 w-full rounded-xl px-4 text-xs font-semibold sm:w-auto">
                Save bet
              </button>
            </div>
          </form>
        ) : null}

        {!bets.length ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">No bets tracked yet.</p>
            <p className="mt-1 text-xs text-muted">
              Add one manually, or use Track this bet inside Bet Lab.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-2 p-3 sm:hidden">
              {bets.map((bet) => {
                const pl = profit(bet);
                return (
                  <article
                    key={bet.id}
                    className="rounded-xl border bg-surface-raised/35 p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.08em] text-faint">
                          {bet.date} · {bet.platform}
                        </p>
                        <p className="mt-1 text-sm font-semibold leading-5">
                          {bet.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBet(bet.id)}
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-negative-bg hover:text-negative"
                        aria-label="Delete bet"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">Stake</p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {money(bet.stake)}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">Payout</p>
                        <p className="mt-1 text-xs font-semibold tabular">
                          {bet.status === "win" ? money(bet.payout) : "—"}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-surface p-2.5">
                        <p className="text-[9px] text-faint">P/L</p>
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

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-[9px] text-faint">
                          Result
                        </span>
                        <select
                          value={bet.status}
                          onChange={(event) =>
                            updateStatus(
                              bet.id,
                              event.target.value as ManualBet["status"],
                            )
                          }
                          className="h-10 w-full rounded-lg border bg-surface px-2.5 text-[11px]"
                        >
                          <option value="open">Open</option>
                          <option value="win">Win</option>
                          <option value="loss">Loss</option>
                          <option value="push">Push / void</option>
                        </select>
                      </label>

                      {bet.status === "win" ? (
                        <label>
                          <span className="mb-1 block text-[9px] text-faint">
                            Payout
                          </span>
                          <input
                            aria-label="Payout"
                            type="number"
                            min="0"
                            step="0.01"
                            value={bet.payout || ""}
                            onChange={(event) =>
                              updatePayout(
                                bet.id,
                                Number(event.target.value || 0),
                              )
                            }
                            className="h-10 w-full rounded-lg border bg-surface px-3 text-[11px]"
                          />
                        </label>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b bg-surface-raised text-[10px] uppercase tracking-[0.09em] text-faint">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-3 py-3">Bet</th>
                    <th className="px-3 py-3">Platform</th>
                    <th className="px-3 py-3">Result</th>
                    <th className="px-3 py-3 text-right">Stake</th>
                    <th className="px-3 py-3 text-right">Payout</th>
                    <th className="px-3 py-3 text-right">P/L</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {bets.map((bet) => {
                    const pl = profit(bet);
                    return (
                      <tr
                        key={bet.id}
                        className="border-t transition-colors hover:bg-surface-raised/50"
                      >
                        <td className="px-4 py-3 tabular">{bet.date}</td>
                        <td className="max-w-[320px] px-3 py-3 font-medium">
                          {bet.description}
                        </td>
                        <td className="px-3 py-3 capitalize">{bet.platform}</td>
                        <td className="px-3 py-3">
                          <select
                            value={bet.status}
                            onChange={(event) =>
                              updateStatus(
                                bet.id,
                                event.target.value as ManualBet["status"],
                              )
                            }
                            className={cn(
                              "h-8 rounded-md border-0 px-2 text-[11px] font-medium",
                              resultTone(bet.status),
                            )}
                          >
                            <option value="open">Open</option>
                            <option value="win">Win</option>
                            <option value="loss">Loss</option>
                            <option value="push">Push / void</option>
                          </select>
                        </td>
                        <td className="px-3 py-3 text-right tabular">
                          {money(bet.stake)}
                        </td>
                        <td className="px-3 py-3 text-right tabular">
                          {bet.status === "win" ? (
                            <input
                              aria-label="Payout"
                              type="number"
                              min="0"
                              step="0.01"
                              value={bet.payout || ""}
                              onChange={(event) =>
                                updatePayout(
                                  bet.id,
                                  Number(event.target.value || 0),
                                )
                              }
                              className="h-8 w-24 rounded-md border bg-background px-2 text-right text-[11px]"
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 text-right font-semibold tabular",
                            (pl ?? 0) > 0
                              ? "text-positive"
                              : (pl ?? 0) < 0
                                ? "text-negative"
                                : "",
                          )}
                        >
                          {money(pl)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeBet(bet.id)}
                            className="grid size-7 place-items-center rounded-md text-muted hover:bg-negative-bg hover:text-negative"
                            aria-label="Delete bet"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
