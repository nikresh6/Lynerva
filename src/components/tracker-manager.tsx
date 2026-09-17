"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createPosition, deletePosition, updatePosition, type PositionActionState } from "@/app/tracker/actions";
import { cn, formatMoney } from "@/lib/utils";

export interface TrackerPositionView {
  id: string;
  placedAt: string;
  platform: string;
  type: string;
  description: string;
  stakeCents: number;
  entryPriceBps: number | null;
  status: string;
  payoutCents: number | null;
  profitCents: number | null;
  notes: string | null;
}

export interface TrackerSummaryView {
  netProfitCents: number;
  roi: number;
  amountRiskedCents: number;
  winRate: number;
  openExposureCents: number;
}

const initialState: PositionActionState = { ok: false, message: "" };

function FormField({ label, error, children, className }: { label: string; error?: string[]; children: React.ReactNode; className?: string }) {
  return <label className={cn("block", className)}><span className="mb-1.5 block text-[11px] font-medium text-muted">{label}</span>{children}{error?.[0] ? <span className="mt-1 block text-[10px] text-negative">{error[0]}</span> : null}</label>;
}

function PositionForm({ position, today, onDone }: { position?: TrackerPositionView; today: string; onDone: () => void }) {
  const action = position ? updatePosition.bind(null, position.id) : createPosition;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) { formRef.current?.reset(); onDone(); } }, [onDone, state.ok]);
  const input = "h-9 w-full rounded-md border bg-surface px-2.5 text-xs outline-none focus:border-foreground";
  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label="Date" error={state.errors?.placedAt}><input className={input} name="placedAt" type="date" required defaultValue={position?.placedAt.slice(0, 10) ?? today} /></FormField>
      <FormField label="Platform" error={state.errors?.platform}><select className={input} name="platform" defaultValue={position?.platform ?? "kalshi"}><option value="kalshi">Kalshi</option><option value="polymarket">Polymarket</option></select></FormField>
      <FormField label="Type" error={state.errors?.type}><select className={input} name="type" defaultValue={position?.type ?? "single"}><option value="single">Single</option><option value="combination">Combination</option></select></FormField>
      <FormField label="Status" error={state.errors?.status}><select className={input} name="status" defaultValue={position?.status ?? "open"}><option value="open">Open</option><option value="win">Win</option><option value="loss">Loss</option><option value="push">Push / void</option></select></FormField>
      <FormField label="Market / description" error={state.errors?.description} className="sm:col-span-2"><input className={input} name="description" required maxLength={300} defaultValue={position?.description} placeholder="e.g. Bills moneyline" /></FormField>
      <FormField label="Stake" error={state.errors?.stake}><div className="flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-foreground"><span className="mr-1 text-muted">$</span><input className="w-full bg-transparent text-xs outline-none" name="stake" type="number" min="0.01" step="0.01" required defaultValue={position ? (position.stakeCents / 100).toFixed(2) : ""} /></div></FormField>
      <FormField label="Entry price" error={state.errors?.entryPrice}><div className="flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-foreground"><input className="w-full bg-transparent text-xs outline-none" name="entryPrice" type="number" min="0.01" max="0.99" step="0.01" defaultValue={position?.entryPriceBps ? (position.entryPriceBps / 10_000).toFixed(2) : ""} placeholder="0.54" /><span className="text-muted">$</span></div></FormField>
      <FormField label="Payout (optional)" error={state.errors?.payout}><div className="flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-foreground"><span className="mr-1 text-muted">$</span><input className="w-full bg-transparent text-xs outline-none" name="payout" type="number" min="0" step="0.01" defaultValue={position?.payoutCents !== null && position?.payoutCents !== undefined ? (position.payoutCents / 100).toFixed(2) : ""} /></div></FormField>
      <FormField label="Notes (optional)" error={state.errors?.notes}><input className={input} name="notes" maxLength={1000} defaultValue={position?.notes ?? ""} /></FormField>
      {state.message && !state.ok ? <p role="alert" className="sm:col-span-2 text-xs text-negative">{state.message}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onDone} className="rounded-md px-3 py-2 text-xs text-muted hover:text-foreground">Cancel</button><button disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background disabled:opacity-50">{pending ? "Saving…" : position ? "Save changes" : "Add position"}</button></div>
    </form>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return <div className="border-r px-4 last:border-0 first:pl-0"><p className="text-[10px] uppercase tracking-[0.09em] text-faint">{label}</p><p className={cn("mt-1.5 text-lg font-semibold tabular", tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "")}>{value}</p></div>;
}

export function TrackerManager({ positions, summary, today }: { positions: TrackerPositionView[]; summary: TrackerSummaryView; today: string }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  return (
    <>
      <div className="scrollbar-subtle mb-5 grid min-w-[650px] grid-cols-5 overflow-x-auto border-b pb-5 sm:min-w-0">
        <SummaryItem label="Net P/L" value={formatMoney(summary.netProfitCents)} tone={summary.netProfitCents > 0 ? "positive" : summary.netProfitCents < 0 ? "negative" : undefined} />
        <SummaryItem label="ROI" value={`${(summary.roi * 100).toFixed(1)}%`} tone={summary.roi > 0 ? "positive" : summary.roi < 0 ? "negative" : undefined} />
        <SummaryItem label="Amount risked" value={formatMoney(summary.amountRiskedCents)} />
        <SummaryItem label="Win rate" value={`${(summary.winRate * 100).toFixed(0)}%`} />
        <SummaryItem label="Open exposure" value={formatMoney(summary.openExposureCents)} />
      </div>
      <div className="mb-4 flex justify-end"><button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background"><Plus size={14} /> Add position</button></div>
      {adding ? <div className="mb-5 rounded-lg border bg-surface p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Add position</h2><button type="button" onClick={() => setAdding(false)} aria-label="Close" className="text-muted"><X size={16} /></button></div><PositionForm today={today} onDone={() => setAdding(false)} /></div> : null}
      {!positions.length ? <div className="rounded-lg border bg-surface px-6 py-16 text-center"><p className="font-medium">No positions yet.</p><p className="mt-1 text-xs text-muted">Add a manual position to begin tracking results.</p></div> : <div className="scrollbar-subtle overflow-x-auto rounded-lg border bg-surface"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-surface-raised text-[10px] uppercase tracking-[0.09em] text-faint"><tr><th className="px-4 py-3">Date</th><th className="px-3 py-3">Market</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Stake</th><th className="px-3 py-3 text-right">Payout</th><th className="px-3 py-3 text-right">P/L</th><th className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th></tr></thead><tbody>{positions.map((position) => <tr key={position.id} className="border-t"><td className="whitespace-nowrap px-4 py-3 tabular">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(position.placedAt))}</td><td className="max-w-[300px] px-3 py-3"><p className="truncate font-medium">{position.description}</p><p className="mt-0.5 capitalize text-[10px] text-faint">{position.type}</p></td><td className="px-3 py-3 capitalize">{position.platform}</td><td className="px-3 py-3"><span className={cn("rounded px-1.5 py-0.5 capitalize", position.status === "win" ? "bg-positive-bg text-positive" : position.status === "loss" ? "bg-negative-bg text-negative" : "bg-background text-muted")}>{position.status === "push" ? "Push / void" : position.status}</span></td><td className="px-3 py-3 text-right tabular">{formatMoney(position.stakeCents)}</td><td className="px-3 py-3 text-right tabular">{formatMoney(position.payoutCents)}</td><td className={cn("px-3 py-3 text-right font-medium tabular", (position.profitCents ?? 0) > 0 ? "text-positive" : (position.profitCents ?? 0) < 0 ? "text-negative" : "")}>{formatMoney(position.profitCents)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => setEditing(position.id)} className="grid size-7 place-items-center rounded text-muted hover:bg-background hover:text-foreground" aria-label={`Edit ${position.description}`}><Pencil size={13} /></button><button type="button" disabled={deleting} onClick={() => startDelete(() => deletePosition(position.id))} className="grid size-7 place-items-center rounded text-muted hover:bg-negative-bg hover:text-negative" aria-label={`Delete ${position.description}`}><Trash2 size={13} /></button></div></td></tr>)}</tbody></table></div>}
      {editing ? <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4"><div className="scrollbar-subtle max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border bg-surface p-5 shadow-[0_20px_60px_rgb(0_0_0/0.24)]"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Edit position</h2><button type="button" onClick={() => setEditing(null)} aria-label="Close" className="text-muted"><X size={16} /></button></div><PositionForm key={editing} position={positions.find((item) => item.id === editing)} today={today} onDone={() => setEditing(null)} /></div></div> : null}
    </>
  );
}
