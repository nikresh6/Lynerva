"use client";

import { useMemo, useState } from "react";
import { buildCombination } from "@/lib/builder";
import type { MarketOpportunity } from "@/lib/markets/types";
import { formatCents, formatEdge, formatPercent } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-medium text-muted">{children}</span>;
}

export function BuilderWorkbench({ markets }: { markets: MarketOpportunity[] }) {
  const [minReturn, setMinReturn] = useState(3);
  const [maxReturn, setMaxReturn] = useState(5);
  const [maxLegs, setMaxLegs] = useState(4);
  const [platform, setPlatform] = useState<"either" | "kalshi" | "polymarket">("either");
  const [live, setLive] = useState<"all" | "pregame" | "live">("pregame");
  const [excludeSameGame, setExcludeSameGame] = useState(true);
  const combination = useMemo(
    () => buildCombination(markets, { minReturn, maxReturn, maxLegs, platform, live, excludeSameGame }),
    [excludeSameGame, live, markets, maxLegs, maxReturn, minReturn, platform],
  );
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <section className="h-fit rounded-lg border bg-surface p-4 lg:sticky lg:top-24">
        <h2 className="mb-4 text-sm font-semibold">Return target</h2>
        <div className="grid grid-cols-2 gap-3">
          <label><FieldLabel>Minimum</FieldLabel><div className="flex h-9 items-center rounded-md border px-2.5"><input type="number" min="1.1" max="50" step="0.5" value={minReturn} onChange={(event) => setMinReturn(Number(event.target.value))} className="w-full bg-transparent text-sm outline-none tabular" /><span className="text-muted">x</span></div></label>
          <label><FieldLabel>Maximum</FieldLabel><div className="flex h-9 items-center rounded-md border px-2.5"><input type="number" min={minReturn} max="100" step="0.5" value={maxReturn} onChange={(event) => setMaxReturn(Number(event.target.value))} className="w-full bg-transparent text-sm outline-none tabular" /><span className="text-muted">x</span></div></label>
        </div>
        <label className="mt-4 block"><FieldLabel>Maximum legs</FieldLabel><select value={maxLegs} onChange={(event) => setMaxLegs(Number(event.target.value))} className="h-9 w-full rounded-md border bg-surface px-2.5 text-xs outline-none"><option value="2">2 legs</option><option value="3">3 legs</option><option value="4">4 legs</option><option value="5">5 legs</option><option value="6">6 legs</option></select></label>
        <label className="mt-4 block"><FieldLabel>Platform</FieldLabel><select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)} className="h-9 w-full rounded-md border bg-surface px-2.5 text-xs outline-none"><option value="either">Either</option><option value="kalshi">Kalshi only</option><option value="polymarket">Polymarket only</option></select></label>
        <label className="mt-4 block"><FieldLabel>Market state</FieldLabel><select value={live} onChange={(event) => setLive(event.target.value as typeof live)} className="h-9 w-full rounded-md border bg-surface px-2.5 text-xs outline-none"><option value="pregame">Pregame only</option><option value="live">Live only</option><option value="all">Pregame + live</option></select></label>
        <label className="mt-4 flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={excludeSameGame} onChange={(event) => setExcludeSameGame(event.target.checked)} className="mt-0.5" /><span>Exclude same-game combinations <span className="text-muted">when correlation cannot be measured reliably.</span></span></label>
      </section>
      <section className="rounded-lg border bg-surface">
        {!combination ? (
          <div className="px-6 py-20 text-center"><p className="font-medium">No combination fits this target</p><p className="mt-1 text-xs text-muted">Only fresh markets with a positive modeled edge are eligible. Try a wider return range.</p></div>
        ) : (
          <>
            <div className="border-b px-5 py-4"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[0.1em] text-faint">Research combination</p><p className="mt-1 text-xl font-semibold tabular">{combination.grossReturn.toFixed(2)}x gross return</p></div><div className="grid grid-cols-3 gap-6 text-right"><div><p className="text-[10px] text-faint">Model</p><p className="mt-1 font-medium tabular">{formatPercent(Math.round(combination.estimatedProbability * 10_000), 1)}</p></div><div><p className="text-[10px] text-faint">Implied</p><p className="mt-1 font-medium tabular">{formatPercent(Math.round(combination.impliedProbability * 10_000), 1)}</p></div><div><p className="text-[10px] text-faint">Combined edge</p><p className="mt-1 font-medium text-positive tabular">{formatEdge(Math.round(combination.estimatedEdge * 10_000))}</p></div></div></div></div>
            <ol className="divide-y">{combination.legs.map((leg, index) => <li key={`${leg.platform}:${leg.platformMarketId}`} className="grid grid-cols-[28px_1fr_auto] gap-3 px-5 py-4"><span className="grid size-6 place-items-center rounded-full border text-[10px] text-muted">{index + 1}</span><div><p className="font-medium leading-5">{leg.marketTitle}</p><div className="mt-1"><PlatformMark platform={leg.platform} /></div></div><div className="text-right"><p className="font-medium tabular">{formatCents(leg.executablePriceBps)}</p><p className="mt-1 text-[11px] text-positive tabular">{formatEdge(leg.edgeBps)}</p></div></li>)}</ol>
            <div className="border-t bg-surface-raised px-5 py-4 text-xs leading-5 text-muted"><strong className="font-medium text-foreground">Not a single executable combo.</strong> This is research for individually available contracts. {combination.correlationWarning ? "One or more legs share a game; independence is uncertain and the combined probability may be overstated." : "Legs are drawn from different games to reduce obvious correlation risk."}</div>
          </>
        )}
      </section>
    </div>
  );
}
