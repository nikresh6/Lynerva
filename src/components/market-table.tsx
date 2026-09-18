"use client";

import { ExternalLink, FlaskConical, TrendingUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import {
  cn,
  formatCents,
  formatCompactMoney,
  formatEdge,
  formatPercent,
  relativeTime,
  titleCase,
} from "@/lib/utils";
import { PlatformMark } from "./platform-mark";

const FAMILY_LABEL: Record<string, string> = {
  passing_yards: "Passing Yards",
  passing_touchdowns: "Passing TDs",
  rushing_yards: "Rushing Yards",
  receiving_yards: "Receiving Yards",
  receptions: "Receptions",
  touchdowns: "Touchdowns",
  moneyline: "Moneyline",
  spread: "Spread",
  game_total: "Game Total",
};

const TEAM_CODES = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
  "HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
]);

function teamLogo(team: string) {
  const slug = team === "WAS" ? "wsh" : team.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

function displayMarketTitle(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.marketTitle;
  const label = FAMILY_LABEL[canonical.family] ?? titleCase(canonical.family);
  if (
    canonical.threshold !== null &&
    ["passing_yards","passing_touchdowns","rushing_yards","receiving_yards","receptions","touchdowns"].includes(canonical.family)
  ) {
    if (
      canonical.family === "touchdowns" &&
      canonical.direction === "over" &&
      Number.isInteger(canonical.threshold)
    ) {
      return `${canonical.subject} ${canonical.threshold}+ ${label}`;
    }
    return `${canonical.subject} ${canonical.direction === "under" ? "Under" : "Over"} ${canonical.threshold} ${label}`;
  }
  return market.marketTitle;
}

function displayMarketContext(market: MarketOpportunity) {
  return market.canonical?.matchup?.replace("-", " vs ") ?? market.eventTitle;
}

function displayPickSide(market: MarketOpportunity) {
  if (!market.recommendedSide) return "—";
  const direction = market.canonical?.direction;
  if (market.recommendedSide === "yes") {
    if (direction === "over") return "Over";
    if (direction === "under") return "Under";
    return "Yes";
  }
  if (direction === "over") return "Under";
  if (direction === "under") return "Over";
  return "No";
}

function historicalHitRate(market: MarketOpportunity) {
  const evidence = market.model.evidence;
  if (evidence.seasonHits !== null && evidence.seasonGames && evidence.seasonGames >= 5) {
    const hits =
      market.recommendedSide === "no"
        ? evidence.seasonGames - evidence.seasonHits
        : evidence.seasonHits;
    return Math.round((hits / evidence.seasonGames) * 100);
  }
  if (evidence.last10Hits !== null && evidence.sampleSize) {
    const games = Math.min(10, evidence.sampleSize);
    const hits =
      market.recommendedSide === "no"
        ? games - evidence.last10Hits
        : evidence.last10Hits;
    return Math.round((hits / games) * 100);
  }
  return null;
}

function ScoreRing({ score, size = 58 }: { score: number | null; size?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--positive) ${value * 3.6}deg, var(--border) 0deg)`,
      }}
      aria-label={score === null ? "Score unavailable" : `Lynerva score ${score} out of 100`}
    >
      <div className="grid size-[82%] place-items-center rounded-full bg-surface">
        <div className="text-center leading-none">
          <div className="text-base font-bold tabular">{score ?? "—"}</div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-faint">score</div>
        </div>
      </div>
    </div>
  );
}

function SubjectVisual({ market }: { market: MarketOpportunity }) {
  const subject = market.canonical?.subject ?? "";
  const matchup = market.canonical?.matchup?.split("-") ?? [];
  if (TEAM_CODES.has(subject)) {
    return (
      <div className="grid size-12 shrink-0 place-items-center rounded-xl border bg-background p-1.5">
        <img loading="lazy" src={teamLogo(subject)} alt={subject} className="size-full object-contain" />
      </div>
    );
  }
  const initials = subject
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "NFL";
  return (
    <div className="relative grid size-12 shrink-0 place-items-center rounded-xl border bg-surface-raised text-sm font-bold">
      {initials}
      <div className="absolute -bottom-1 -right-1 flex">
        {matchup.slice(0, 2).map((team, index) => (
          <span key={team} className={cn("grid size-5 place-items-center rounded-full border bg-surface p-0.5", index ? "-ml-1.5" : "")}>
            <img loading="lazy" src={teamLogo(team)} alt="" className="size-full object-contain" />
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "muted";
}) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular", tone === "positive" ? "text-positive" : tone === "muted" ? "text-muted" : "")}>
        {value}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="text-muted">{label} <span className="text-faint">({weight})</span></span>
        <span className="font-semibold tabular">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-positive" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function RecentChart({ market }: { market: MarketOpportunity }) {
  const values = market.model.evidence.recentValues ?? [];
  const threshold = market.canonical?.threshold ?? null;
  if (!values.length || threshold === null) return null;
  const max = Math.max(...values, threshold, 1);
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold">Recent sample</div>
          <div className="mt-0.5 text-[10px] text-faint">Last {values.length} regular-season games</div>
        </div>
        <div className="rounded-md border bg-surface px-2 py-1 text-[10px] tabular">Line {threshold}</div>
      </div>
      <div className="flex h-28 items-end gap-1.5">
        {[...values].reverse().map((value, index) => {
          const clears = market.canonical?.direction === "under" ? value < threshold : value >= threshold;
          return (
            <div key={index} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className={cn("w-full rounded-t-sm", clears ? "bg-positive" : "bg-border-strong")}
                style={{ height: `${Math.max(5, (value / max) * 92)}px` }}
                title={String(value)}
              />
              <span className="text-[8px] text-faint">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketLab({ market, onClose }: { market: MarketOpportunity; onClose: () => void }) {
  const [tab, setTab] = useState<"snapshot" | "lab">("lab");
  const breakdown = market.scoreBreakdown;
  const hitRate = historicalHitRate(market);
  const title = displayMarketTitle(market);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const track = () => {
    try {
      localStorage.setItem("lynerva-track-draft", JSON.stringify({
        description: `${displayPickSide(market)} · ${title}`,
        platform: market.platform,
        entryPriceBps: market.executablePriceBps,
      }));
    } catch {}
    window.location.href = "/tracker";
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Bet Lab for ${title}`}>
      <button type="button" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-label="Close details" />
      <aside className="sheet-enter scrollbar-subtle absolute inset-y-0 right-0 w-full overflow-y-auto border-l bg-surface shadow-[0_0_70px_rgb(0_0_0/0.2)] sm:max-w-[650px]">
        <div className="sticky top-0 z-10 border-b bg-[var(--header)] px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-start gap-4">
            <SubjectVisual market={market} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><PlatformMark platform={market.platform} /><span className="rounded-full bg-positive-bg px-2 py-0.5 text-[10px] font-semibold text-positive">{displayPickSide(market)}</span></div>
              <h2 className="mt-2 text-lg font-semibold leading-snug">{title}</h2>
              <p className="mt-0.5 text-xs text-muted">{displayMarketContext(market)}</p>
            </div>
            <ScoreRing score={market.lynervaScore} size={64} />
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-background" aria-label="Close"><X size={17} /></button>
          </div>
          <div className="mt-4 flex gap-1 rounded-lg bg-background p-1">
            {(["snapshot", "lab"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setTab(value)} className={cn("flex-1 rounded-md px-3 py-2 text-xs font-medium", tab === value ? "bg-surface shadow-sm" : "text-muted")}>
                {value === "snapshot" ? "Quick view" : "Bet Lab"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-7">
          {tab === "snapshot" ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border bg-background p-3"><Metric label="Price" value={formatCents(market.executablePriceBps)} /></div>
                <div className="rounded-xl border bg-background p-3"><Metric label="Model" value={formatPercent(market.recommendedProbabilityBps)} /></div>
                <div className="rounded-xl border bg-positive-bg p-3"><Metric label="Edge" value={formatEdge(market.edgeBps)} tone="positive" /></div>
                <div className="rounded-xl border bg-background p-3"><Metric label="Risk : return" value={market.riskReturn === null ? "—" : `1 : ${market.riskReturn.toFixed(2)}`} /></div>
              </div>
              <div className="rounded-xl border bg-background p-4">
                <div className="mb-3 text-xs font-semibold">Why it ranks here</div>
                <div className="space-y-2 text-xs leading-5 text-muted">
                  {market.model.factors.map((factor) => <p key={factor}>{factor}</p>)}
                </div>
              </div>
            </>
          ) : (
            <>
              <section className="rounded-2xl border bg-background p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div><div className="flex items-center gap-2 text-sm font-semibold"><FlaskConical size={16} /> Lynerva Score</div><p className="mt-1 text-[11px] text-muted">Risk-adjusted value, hit evidence, model confidence, edge and market quality.</p></div>
                  <div className="text-3xl font-bold tabular">{market.lynervaScore ?? "—"}<span className="text-sm font-medium text-faint">/100</span></div>
                </div>
                {breakdown ? <div className="space-y-3">
                  <ScoreBar label="Risk-adjusted value" value={breakdown.value} weight="32%" />
                  <ScoreBar label="Historical hit rate" value={breakdown.hitRate} weight="20%" />
                  <ScoreBar label="Model probability" value={breakdown.probability} weight="14%" />
                  <ScoreBar label="Model reliability" value={breakdown.reliability} weight="14%" />
                  <ScoreBar label="Edge strength" value={breakdown.edge} weight="10%" />
                  <ScoreBar label="Market quality" value={breakdown.marketQuality} weight="10%" />
                </div> : <p className="text-xs text-muted">Score unavailable.</p>}
              </section>

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Market price" value={formatCents(market.executablePriceBps)} /></div>
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Model chance" value={formatPercent(market.recommendedProbabilityBps)} /></div>
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Edge" value={formatEdge(market.edgeBps)} tone="positive" /></div>
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Hit rate" value={hitRate === null ? "—" : `${hitRate}%`} /></div>
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Reliability" value={formatPercent(market.model.reliabilityBps)} /></div>
                <div className="rounded-xl border bg-surface-raised p-4"><Metric label="Risk : return" value={market.riskReturn === null ? "—" : `1 : ${market.riskReturn.toFixed(2)}`} /></div>
              </section>

              <RecentChart market={market} />

              <section className="rounded-xl border bg-background p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><TrendingUp size={14} /> Market diagnostics</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                  <div><div className="text-faint">Expected ROI</div><div className="mt-1 font-semibold tabular">{market.expectedRoi === null ? "—" : `${(market.expectedRoi * 100).toFixed(1)}%`}</div></div>
                  <div><div className="text-faint">Spread</div><div className="mt-1 font-semibold tabular">{market.spreadBps === null ? "—" : `${(market.spreadBps / 100).toFixed(1)} pp`}</div></div>
                  <div><div className="text-faint">Volume</div><div className="mt-1 font-semibold tabular">{formatCompactMoney(market.volumeCents)}</div></div>
                  <div><div className="text-faint">Liquidity</div><div className="mt-1 font-semibold tabular">{formatCompactMoney(market.liquidityCents)}</div></div>
                  <div><div className="text-faint">Sample size</div><div className="mt-1 font-semibold tabular">{market.model.evidence.sampleSize}</div></div>
                  <div><div className="text-faint">Updated</div><div className="mt-1 font-semibold">{relativeTime(market.updatedAt)}</div></div>
                </div>
              </section>

              <section className="rounded-xl border bg-background p-4">
                <div className="mb-3 text-xs font-semibold">Model notes</div>
                <div className="space-y-2 text-xs leading-5 text-muted">
                  {market.model.factors.map((factor) => <p key={factor}>• {factor}</p>)}
                </div>
              </section>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={track} className="rounded-lg bg-foreground px-4 py-2.5 text-xs font-semibold text-background">Track this bet</button>
            <a href={market.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-xs font-semibold">Open on {titleCase(market.platform)} <ExternalLink size={12} /></a>
          </div>
          <p className="text-[10px] leading-4 text-faint">Lynerva scores are model-based estimates, not guarantees. The score is for ranking opportunities, not a probability of profit.</p>
        </div>
      </aside>
    </div>
  );
}

export function MarketTable({
  markets,
  emptyMessage = "No NFL markets match these filters.",
}: {
  markets: MarketOpportunity[];
  emptyMessage?: string;
}) {
  const [selected, setSelected] = useState<MarketOpportunity | null>(null);
  const ranked = useMemo(
    () => markets.toSorted((a, b) => (b.lynervaScore ?? -1) - (a.lynervaScore ?? -1)),
    [markets],
  );

  if (!ranked.length) {
    return <div className="rounded-xl border bg-surface px-6 py-16 text-center"><p className="font-medium">{emptyMessage}</p><p className="mt-1 text-xs text-muted">Try clearing a filter or check back when markets reopen.</p></div>;
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ranked.map((market, index) => {
          const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
          const hitRate = historicalHitRate(market);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(market)}
              className="group rounded-2xl border bg-surface p-4 text-left transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_8px_24px_rgb(0_0_0/0.06)]"
            >
              <div className="flex items-start gap-3">
                <div className="relative">
                  <SubjectVisual market={market} />
                  <span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-[9px] font-bold text-background">{index + 1}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><PlatformMark platform={market.platform} />{market.isLive ? <span className="rounded-full bg-negative-bg px-1.5 py-0.5 text-[9px] font-bold uppercase text-negative">Live</span> : null}</div>
                  <div className="mt-2 line-clamp-2 font-semibold leading-5"><span className="mr-1.5 text-positive">{displayPickSide(market)}</span>{displayMarketTitle(market)}</div>
                  <div className="mt-1 text-[11px] text-faint">{displayMarketContext(market)}</div>
                </div>
                <ScoreRing score={market.lynervaScore} />
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl bg-background p-3">
                <Metric label="Price" value={formatCents(market.executablePriceBps)} />
                <Metric label="Model" value={formatPercent(market.recommendedProbabilityBps)} />
                <Metric label="Edge" value={formatEdge(market.edgeBps)} tone="positive" />
                <Metric label="Hit rate" value={hitRate === null ? "—" : `${hitRate}%`} />
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                <span>Risk : return <strong className="font-semibold text-foreground tabular">{market.riskReturn === null ? "—" : `1 : ${market.riskReturn.toFixed(2)}`}</strong></span>
                <span>Open Bet Lab →</span>
              </div>
            </button>
          );
        })}
      </div>
      {selected ? <MarketLab market={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
