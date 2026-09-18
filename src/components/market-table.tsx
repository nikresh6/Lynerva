"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatCents, formatCompactMoney, formatEdge, formatPercent, relativeTime, titleCase } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";

function HitRate({ market }: { market: MarketOpportunity }) {
  const { seasonHits, seasonGames } = market.model.evidence;
  if (seasonHits === null || !seasonGames) return <span className="text-faint">—</span>;
  return <span className="tabular">{Math.round((seasonHits / seasonGames) * 100)}% <span className="text-faint">({seasonGames})</span></span>;
}

function FreshnessLabel({ value }: { value: MarketOpportunity["freshness"] }) {
  return <span className={cn("capitalize", value === "fresh" ? "text-positive" : value === "stale" || value === "unavailable" ? "text-negative" : "text-warning")}>{value}</span>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-5 border-b py-2.5 last:border-0"><dt className="text-xs text-muted">{label}</dt><dd className="text-right text-xs font-medium tabular">{children}</dd></div>;
}

function MarketDrawer({ market, onClose }: { market: MarketOpportunity; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [onClose]);
  const evidence = market.model.evidence;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Details for ${market.marketTitle}`}>
      <button type="button" className="absolute inset-0 cursor-default bg-[var(--overlay)]" onClick={onClose} aria-label="Close details" />
      <aside className="sheet-enter scrollbar-subtle absolute inset-y-0 right-0 w-full overflow-y-auto border-l bg-surface p-5 shadow-[0_0_60px_rgb(0_0_0/0.18)] sm:max-w-[500px] sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><PlatformMark platform={market.platform} /><h2 className="mt-2 text-xl font-semibold leading-snug tracking-[-0.025em]">{market.marketTitle}</h2><p className="mt-1 text-xs text-muted">{market.eventTitle}</p></div>
          <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-background hover:text-foreground" aria-label="Close"><X size={17} /></button>
        </div>
        {market.arbitrage ? <div className={cn("mb-6 rounded-md border p-3 text-xs leading-5", market.arbitrage.classification === "arbitrage" ? "border-positive/30 bg-positive-bg text-positive" : "border-warning/30 bg-warning-bg text-warning")}><strong className="block font-semibold">{market.arbitrage.classification === "arbitrage" ? "Executable arbitrage" : "Price dislocation"}</strong>{market.arbitrage.reason}</div> : null}
        <section className="mb-7"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Summary</h3><dl><DetailRow label="Executable YES ask">{formatCents(market.executablePriceBps)}</DetailRow><DetailRow label="Model probability">{formatPercent(market.model.probabilityBps)}</DetailRow><DetailRow label="Edge"><span className={cn((market.edgeBps ?? 0) > 0 ? "text-positive" : (market.edgeBps ?? 0) < 0 ? "text-negative" : "")}>{formatEdge(market.edgeBps)}</span></DetailRow><DetailRow label="Risk : Return">{market.riskReturn === null ? "—" : `1 : ${market.riskReturn.toFixed(2)}`}</DetailRow><DetailRow label="Liquidity">{formatCompactMoney(market.liquidityCents)}</DetailRow><DetailRow label="Updated"><FreshnessLabel value={market.freshness} /> · {relativeTime(market.updatedAt)}</DetailRow></dl></section>
        <section className="mb-7"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Historical</h3><dl><DetailRow label="Last 5">{evidence.last5Hits === null ? "—" : `${evidence.last5Hits} / 5`}</DetailRow><DetailRow label="Last 10">{evidence.last10Hits === null ? "—" : `${evidence.last10Hits} / ${Math.min(10, evidence.sampleSize)}`}</DetailRow><DetailRow label="Season">{evidence.seasonHits === null ? "—" : `${evidence.seasonHits} / ${evidence.seasonGames}`}</DetailRow></dl></section>
        <section className="mb-7"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Model</h3><div className="rounded-md border bg-background p-3"><div className="mb-2 flex justify-between text-xs"><span className="text-muted">Version</span><span className="font-mono text-[11px]">{market.model.version}</span></div><div className="mb-3 flex justify-between text-xs"><span className="text-muted">Reliability</span><span>{formatPercent(market.model.reliabilityBps)}</span></div><ul className="space-y-2 text-xs leading-5 text-muted">{market.model.factors.map((factor) => <li key={factor}>— {factor}</li>)}</ul></div></section>
        <section className="mb-7"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Contract</h3><p className="whitespace-pre-line text-xs leading-5 text-muted">{market.resolutionRules || "The provider did not expose settlement language in this response. Lynerva will not classify this contract as arbitrage without verified rules."}</p></section>
        <a href={market.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline">Open on {titleCase(market.platform)} <ExternalLink size={12} /></a>
      </aside>
    </div>
  );
}

export function MarketTable({ markets, emptyMessage = "No NFL markets match these filters." }: { markets: MarketOpportunity[]; emptyMessage?: string }) {
  const [selected, setSelected] = useState<MarketOpportunity | null>(null);
  if (!markets.length) return <div className="rounded-lg border bg-surface px-6 py-16 text-center"><p className="font-medium">{emptyMessage}</p><p className="mt-1 text-xs text-muted">Try clearing a filter or check back when markets reopen.</p></div>;
  return (
    <>
      <div className="scrollbar-subtle overflow-x-auto rounded-lg border bg-surface">
        <table className="w-full min-w-[960px] border-collapse text-left text-xs">
          <thead className="bg-surface-raised text-[10px] font-medium uppercase tracking-[0.09em] text-faint"><tr><th className="w-[28%] px-4 py-3">Market</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3 text-right">Price</th><th className="px-3 py-3 text-right">Model</th><th className="px-3 py-3 text-right">Edge</th><th className="px-3 py-3 text-right">Hit rate</th><th className="px-3 py-3 text-right">Risk : Return</th><th className="px-3 py-3 text-right">Liquidity</th><th className="px-4 py-3 text-right">Updated</th></tr></thead>
          <tbody>{markets.map((market) => {
            const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
            return <tr key={key} tabIndex={0} role="button" onClick={() => setSelected(market)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(market); }} className="market-row cursor-pointer border-t transition-colors hover:bg-surface-raised focus:bg-surface-raised focus:outline-none"><td className="px-4 py-3"><div className="flex items-start gap-2"><div className="min-w-0"><div className="max-h-10 overflow-hidden font-medium leading-5" title={market.marketTitle}>{market.marketTitle}</div><div className="mt-0.5 truncate text-[11px] text-faint" title={market.eventTitle}>{market.eventTitle}</div></div>{market.arbitrage ? <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", market.arbitrage.classification === "arbitrage" ? "bg-positive-bg text-positive" : "bg-warning-bg text-warning")}>{market.arbitrage.classification === "arbitrage" ? "Arb" : "Gap"}</span> : null}</div></td><td className="px-3 py-3"><PlatformMark platform={market.platform} /></td><td className="px-3 py-3 text-right font-medium tabular">{formatCents(market.executablePriceBps)}</td><td className="px-3 py-3 text-right tabular">{formatPercent(market.model.probabilityBps)}</td><td className={cn("px-3 py-3 text-right font-medium tabular", (market.edgeBps ?? 0) > 0 ? "text-positive" : (market.edgeBps ?? 0) < 0 ? "text-negative" : "text-faint")}>{formatEdge(market.edgeBps)}</td><td className="px-3 py-3 text-right"><HitRate market={market} /></td><td className="px-3 py-3 text-right tabular">{market.riskReturn === null ? "—" : `1 : ${market.riskReturn.toFixed(2)}`}</td><td className="px-3 py-3 text-right tabular">{formatCompactMoney(market.liquidityCents)}</td><td className="px-4 py-3 text-right"><span className="block"><FreshnessLabel value={market.freshness} /></span><span className="text-[10px] text-faint">{relativeTime(market.updatedAt)}</span></td></tr>;
          })}</tbody>
        </table>
      </div>
      {selected ? <MarketDrawer market={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
