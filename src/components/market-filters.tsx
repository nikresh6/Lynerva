import Link from "next/link";
import { SlidersHorizontal, Search } from "lucide-react";
import type { MarketFilters } from "@/lib/markets/types";

function Select({ name, value, children, label }: { name: string; value: string; children: React.ReactNode; label: string }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value} className="h-9 appearance-none rounded-md border bg-surface py-1 pl-2.5 pr-7 text-xs text-foreground outline-none transition-colors hover:border-border-strong focus:border-foreground">
        {children}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted">▾</span>
    </label>
  );
}

function NumberField({ name, label, value, suffix }: { name: string; label: string; value: number | null; suffix: string }) {
  return (
    <label className="space-y-1 text-[11px] text-muted">
      <span>{label}</span>
      <div className="flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-foreground">
        <input name={name} type="number" min="0" step="1" defaultValue={value ?? ""} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
        <span className="ml-2 text-faint">{suffix}</span>
      </div>
    </label>
  );
}

export function MarketFiltersBar({ filters, basePath = "/" }: { filters: MarketFilters; basePath?: string }) {
  const activeCount = [filters.query, filters.platform !== "all", filters.status !== "all", filters.family !== "all", filters.side !== "all", filters.minPriceBps !== null, filters.maxPriceBps !== null, filters.minModelBps !== null, filters.minEdgeBps !== null, filters.minLiquidityCents !== null, filters.minHitRateBps !== null].filter(Boolean).length;
  return (
    <form method="get" action={basePath} className="sticky top-14 z-30 mb-4 border-y bg-[var(--header)] py-2 backdrop-blur-xl sm:rounded-lg sm:border sm:px-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[190px] flex-1 sm:max-w-sm">
          <span className="sr-only">Search markets</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input name="q" defaultValue={filters.query} placeholder="Player, team, market…" className="h-9 w-full rounded-md border bg-surface pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-faint focus:border-foreground" />
        </label>
        <Select name="status" value={filters.status} label="Status"><option value="all">All status</option><option value="pregame">Pregame</option><option value="live">Live</option></Select>
        <Select name="type" value={filters.family} label="Market type"><option value="all">All markets</option><option value="moneyline">Moneyline</option><option value="spread">Spread</option><option value="game_total">Game total</option><option value="passing_yards">Passing yards</option><option value="passing_touchdowns">Passing TDs</option><option value="rushing_yards">Rushing yards</option><option value="rushing_touchdowns">Rushing TDs</option><option value="receiving_yards">Receiving yards</option><option value="receiving_touchdowns">Receiving TDs</option><option value="receptions">Receptions</option><option value="touchdowns">Anytime TDs</option></Select>
        <Select name="sort" value={filters.sort} label="Sort"><option value="best">Best opportunity</option><option value="edge">Highest edge</option><option value="probability">Model probability</option><option value="risk_return">Risk : return</option><option value="liquidity">Liquidity</option><option value="discrepancy">Price discrepancy</option><option value="game_time">Game time</option></Select>
        <details className="group relative">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-surface px-2.5 text-xs transition-colors hover:border-border-strong"><SlidersHorizontal size={13} /> More{activeCount > 0 ? <span className="rounded-full bg-foreground px-1.5 text-[10px] text-background">{activeCount}</span> : null}</summary>
          <div className="absolute right-0 top-11 z-50 grid w-[min(420px,calc(100vw-2rem))] grid-cols-2 gap-3 rounded-lg border bg-surface-raised p-4 shadow-[0_16px_50px_rgb(0_0_0/0.14)]">
            <NumberField name="priceMin" label="Minimum price" value={filters.minPriceBps === null ? null : filters.minPriceBps / 100} suffix="¢" />
            <NumberField name="priceMax" label="Maximum price" value={filters.maxPriceBps === null ? null : filters.maxPriceBps / 100} suffix="¢" />
            <NumberField name="modelMin" label="Minimum model" value={filters.minModelBps === null ? null : filters.minModelBps / 100} suffix="%" />
            <NumberField name="edgeMin" label="Minimum edge" value={filters.minEdgeBps === null ? null : filters.minEdgeBps / 100} suffix="pp" />
            <NumberField name="liquidityMin" label="Minimum liquidity" value={filters.minLiquidityCents === null ? null : filters.minLiquidityCents / 100} suffix="$" />
            <NumberField name="hitRateMin" label="Minimum hit rate" value={filters.minHitRateBps === null ? null : filters.minHitRateBps / 100} suffix="%" />
            <div className="col-span-2 flex justify-end gap-2 pt-1"><Link href={basePath} className="rounded-md px-3 py-2 text-xs text-muted hover:text-foreground">Clear</Link><button className="rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background">Apply filters</button></div>
          </div>
        </details>
        <button className="h-9 rounded-md bg-foreground px-3 text-xs font-medium text-background">Apply</button>
        {activeCount > 0 ? <Link href={basePath} className="px-1 text-xs text-muted hover:text-foreground">Clear</Link> : null}
      </div>
    </form>
  );
}
