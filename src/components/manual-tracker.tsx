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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
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
        const draft = JSON.parse(draftRaw) as { description?: string; platform?: ManualBet["platform"] };
        setDescription(draft.description ?? "");
        setPlatform(draft.platform ?? "kalshi");
        setShowForm(true);
        localStorage.removeItem("lynerva-track-draft");
      }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bets)); } catch {}
  }, [bets]);

  const summary = useMemo(() => {
    const settled = bets.filter((bet) => bet.status !== "open");
    const totalRisked = settled.reduce((sum, bet) => sum + bet.stake, 0);
    const net = settled.reduce((sum, bet) => sum + (profit(bet) ?? 0), 0);
    const wins = settled.filter((bet) => bet.status === "win").length;
    const decisions = settled.filter((bet) => bet.status === "win" || bet.status === "loss").length;
    const open = bets.filter((bet) => bet.status === "open").reduce((sum, bet) => sum + bet.stake, 0);
    return {
      net,
      roi: totalRisked ? net / totalRisked : 0,
      wins,
      decisions,
      open,
      totalRisked,
    };
  }, [bets]);

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const stakeValue = Number(stake);
    const payoutValue = Number(payout || 0);
    if (!description.trim() || !Number.isFinite(stakeValue) || stakeValue <= 0) return;
    setBets((current) => [{
      id: crypto.randomUUID(),
      date,
      description: description.trim(),
      platform,
      stake: stakeValue,
      payout: payoutValue,
      status,
    }, ...current]);
    setDescription("");
    setStake("");
    setPayout("");
    setStatus("open");
    setShowForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Net P/L", money(summary.net), summary.net > 0 ? "positive" : summary.net < 0 ? "negative" : ""],
          ["ROI", `${(summary.roi * 100).toFixed(1)}%`, summary.roi > 0 ? "positive" : summary.roi < 0 ? "negative" : ""],
          ["Win rate", summary.decisions ? `${Math.round((summary.wins / summary.decisions) * 100)}%` : "—", ""],
          ["Settled risk", money(summary.totalRisked), ""],
          ["Open risk", money(summary.open), ""],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-2xl border bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
            <div className={cn("mt-2 text-xl font-bold tabular", tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "")}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Manual bet log</h2>
          <p className="mt-0.5 text-xs text-muted">Nothing is connected to your betting accounts. You enter every position and result yourself.</p>
        </div>
        <button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2.5 text-xs font-semibold text-background"><Plus size={14} /> Add bet</button>
      </div>

      {showForm ? (
        <form onSubmit={add} className="grid gap-3 rounded-2xl border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="lg:col-span-2"><span className="mb-1 block text-[10px] text-muted">Bet</span><input value={description} onChange={(e) => setDescription(e.target.value)} required className="h-10 w-full rounded-lg border bg-background px-3 text-xs outline-none" placeholder="Bills moneyline" /></label>
          <label><span className="mb-1 block text-[10px] text-muted">Platform</span><select value={platform} onChange={(e) => setPlatform(e.target.value as ManualBet["platform"])} className="h-10 w-full rounded-lg border bg-background px-2 text-xs"><option value="kalshi">Kalshi</option><option value="polymarket">Polymarket</option></select></label>
          <label><span className="mb-1 block text-[10px] text-muted">Stake ($)</span><input value={stake} onChange={(e) => setStake(e.target.value)} required type="number" min="0.01" step="0.01" className="h-10 w-full rounded-lg border bg-background px-3 text-xs" /></label>
          <label><span className="mb-1 block text-[10px] text-muted">Result</span><select value={status} onChange={(e) => setStatus(e.target.value as ManualBet["status"])} className="h-10 w-full rounded-lg border bg-background px-2 text-xs"><option value="open">Open</option><option value="win">Win</option><option value="loss">Loss</option><option value="push">Push / void</option></select></label>
          <label><span className="mb-1 block text-[10px] text-muted">Payout ($)</span><input value={payout} onChange={(e) => setPayout(e.target.value)} type="number" min="0" step="0.01" className="h-10 w-full rounded-lg border bg-background px-3 text-xs" placeholder="For wins" /></label>
          <label><span className="mb-1 block text-[10px] text-muted">Date</span><input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="h-10 w-full rounded-lg border bg-background px-3 text-xs" /></label>
          <div className="flex items-end lg:col-span-5"><button className="h-10 rounded-lg bg-foreground px-4 text-xs font-semibold text-background">Save bet</button></div>
        </form>
      ) : null}

      {!bets.length ? (
        <div className="rounded-2xl border bg-surface px-6 py-16 text-center">
          <p className="font-medium">No bets tracked yet.</p>
          <p className="mt-1 text-xs text-muted">Add one manually, or click “Track this bet” inside Bet Lab.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-surface">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface-raised text-[10px] uppercase tracking-[0.09em] text-faint"><tr><th className="px-4 py-3">Date</th><th className="px-3 py-3">Bet</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3">Result</th><th className="px-3 py-3 text-right">Stake</th><th className="px-3 py-3 text-right">Payout</th><th className="px-3 py-3 text-right">P/L</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>{bets.map((bet) => {
              const pl = profit(bet);
              return <tr key={bet.id} className="border-t"><td className="px-4 py-3 tabular">{bet.date}</td><td className="max-w-[320px] px-3 py-3 font-medium">{bet.description}</td><td className="px-3 py-3 capitalize">{bet.platform}</td><td className="px-3 py-3 capitalize">{bet.status === "push" ? "Push / void" : bet.status}</td><td className="px-3 py-3 text-right tabular">{money(bet.stake)}</td><td className="px-3 py-3 text-right tabular">{bet.status === "win" ? money(bet.payout) : "—"}</td><td className={cn("px-3 py-3 text-right font-semibold tabular", (pl ?? 0) > 0 ? "text-positive" : (pl ?? 0) < 0 ? "text-negative" : "")}>{money(pl)}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => setBets((current) => current.filter((item) => item.id !== bet.id))} className="grid size-7 place-items-center rounded-md text-muted hover:bg-negative-bg hover:text-negative" aria-label="Delete bet"><Trash2 size={13} /></button></td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
