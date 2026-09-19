"use client";

import { ChevronDown, CloudSun, ExternalLink, FlaskConical, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent, relativeTime, titleCase } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";
import { SubjectVisual } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

const FAMILY_LABEL: Record<string, string> = {
  passing_yards: "Passing Yards",
  passing_touchdowns: "Passing TDs",
  rushing_yards: "Rushing Yards",
  receiving_yards: "Receiving Yards",
  receptions: "Receptions",
  longest_reception: "Longest Reception",
  touchdowns: "Touchdowns",
  moneyline: "Moneyline",
  spread: "Spread",
  game_total: "Game Total",
};

function displayMarketTitle(market: MarketOpportunity) {
  const canonical = market.canonical;
  if (!canonical) return market.marketTitle;
  const label = FAMILY_LABEL[canonical.family] ?? titleCase(canonical.family);

  if (
    canonical.threshold !== null &&
    ["passing_yards","passing_touchdowns","rushing_yards","receiving_yards","receptions","longest_reception","touchdowns"].includes(canonical.family)
  ) {
    if (
      canonical.family === "touchdowns" &&
      canonical.direction === "over" &&
      Number.isInteger(canonical.threshold)
    ) {
      return `${canonical.subject} ${canonical.threshold}+ ${label}`;
    }
    return `${canonical.subject} ${canonical.threshold} ${label}`;
  }

  return market.marketTitle;
}

function displayContext(market: MarketOpportunity) {
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

function americanOdds(priceBps: number | null) {
  if (priceBps === null || priceBps <= 0 || priceBps >= 10_000) return "—";
  const p = priceBps / 10_000;
  const odds =
    p >= 0.5
      ? -Math.round((100 * p) / (1 - p))
      : Math.round((100 * (1 - p)) / p);
  return odds > 0 ? `+${odds}` : String(odds);
}

function profitOn100(market: MarketOpportunity) {
  if (market.riskReturn === null || !Number.isFinite(market.riskReturn)) return null;
  return market.riskReturn * 100;
}

function hitCount(market: MarketOpportunity) {
  const evidence = market.model.evidence;
  if (evidence.last10Hits === null || !evidence.sampleSize) return null;
  const games = Math.min(10, evidence.sampleSize);
  const hits =
    market.recommendedSide === "no"
      ? games - evidence.last10Hits
      : evidence.last10Hits;
  return { hits, games };
}

function hitRate(market: MarketOpportunity) {
  const count = hitCount(market);
  return count ? Math.round((count.hits / count.games) * 100) : null;
}

function scoreTone(score: number | null) {
  if ((score ?? 0) >= 72) return "pick-card-good";
  if ((score ?? 0) >= 52) return "pick-card-watch";
  return "pick-card-low";
}

function scoreLabel(score: number | null) {
  if ((score ?? 0) >= 80) return "Elite setup";
  if ((score ?? 0) >= 72) return "Strong setup";
  if ((score ?? 0) >= 60) return "Worth a look";
  if ((score ?? 0) >= 52) return "Watchlist";
  return "Thin edge";
}

function edgeLabel(market: MarketOpportunity) {
  if (market.edgeBps === null) return null;
  const value = market.edgeBps / 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp edge`;
}

function didPickHit(market: MarketOpportunity, value: number) {
  const threshold = market.canonical?.threshold;
  const direction = market.canonical?.direction;
  if (threshold === null || threshold === undefined || !direction) return false;
  const contractHit =
    direction === "under" ? value < threshold : value >= threshold;
  return market.recommendedSide === "no" ? !contractHit : contractHit;
}

function ScoreRing({ score, size = 58 }: { score: number | null; size?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  const filled = value * 3.6;
  return (
    <div
      className="score-ring relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from -90deg, transparent 0deg ${filled}deg, var(--border) ${filled}deg 360deg), conic-gradient(from -90deg, #ef5b5b 0deg, #f2b84b 180deg, #29b875 360deg)`,
      }}
    >
      <div className="grid size-[82%] place-items-center rounded-full bg-surface shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-lg font-bold tabular leading-none">{score ?? "—"}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] text-faint">{label}</div>
      <div className={cn("mt-1.5 text-[15px] font-semibold tabular leading-none", emphasis ? "text-positive" : "")}>{value}</div>
    </div>
  );
}

function PastPerformance({ market }: { market: MarketOpportunity }) {
  const values = market.model.evidence.recentValues ?? [];
  const threshold = market.canonical?.threshold ?? null;
  const count = hitCount(market);

  if (!values.length || threshold === null) {
    return (
      <section className="rounded-2xl border bg-background p-4">
        <h3 className="text-sm font-semibold">Past performance</h3>
        <p className="mt-2 text-xs text-muted">Not enough comparable regular-season history is available for this market.</p>
      </section>
    );
  }

  const recent = values.slice(0, 10).reverse();
  const max = Math.max(...recent, threshold, 1);

  return (
    <section className="rounded-2xl border bg-background p-4">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Past performance</h3>
          <p className="mt-1 text-xs text-muted">
            {count ? `2026 only: this pick hit in ${count.hits} of ${count.games} game${count.games === 1 ? "" : "s"}.` : "2026 regular-season games only."}
          </p>
        </div>
        <span className="rounded-lg border bg-surface px-2.5 py-1.5 text-[10px] font-medium">Line {threshold}</span>
      </div>

      <div className="flex h-32 items-end gap-1.5">
        {recent.map((value, index) => {
          const hit = didPickHit(market, value);
          return (
            <div key={index} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <div
                className={cn("w-full rounded-t-md", hit ? "bg-positive" : "bg-border-strong")}
                style={{ height: `${Math.max(6, (value / max) * 98)}px` }}
              />
              <span className="text-[8px] tabular text-faint">{value}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-positive" /> Hit</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-border-strong" /> Miss</span>
      </div>
    </section>
  );
}

interface WeatherPayload {
  available: boolean;
  indoor?: boolean;
  condition?: string;
  temperatureF?: number | null;
  windMph?: number | null;
  rainChance?: number | null;
  impact?: {
    tone: "positive" | "negative" | "neutral";
    label: string;
    detail: string;
  };
  message?: string;
}

function WeatherCard({ market }: { market: MarketOpportunity }) {
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const matchup = market.canonical?.matchup;

  useEffect(() => {
    if (!matchup || !market.canonical) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      matchup,
      family: market.canonical.family,
      direction: market.canonical.direction,
      side: market.recommendedSide ?? "yes",
    });

    const timer = window.setTimeout(() => controller.abort(), 2_500);
    fetch(`/api/bet-lab?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: WeatherPayload) => setWeather(payload))
      .catch(() => setWeather({ available: false, message: "Weather is unavailable right now." }))
      .finally(() => {
        window.clearTimeout(timer);
        setLoading(false);
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [market, matchup]);

  return (
    <section className="rounded-2xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <CloudSun size={16} />
        <h3 className="text-sm font-semibold">Game-day weather</h3>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted">Checking the forecast…</p>
      ) : !weather?.available ? (
        <p className="mt-3 text-xs text-muted">{weather?.message ?? "Forecast unavailable."}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Conditions" value={weather.condition ?? "—"} />
            <Metric label="Temperature" value={weather.temperatureF === null || weather.temperatureF === undefined ? "—" : `${Math.round(weather.temperatureF)}°F`} />
            <Metric label="Wind / rain" value={weather.indoor ? "Indoor" : `${Math.round(weather.windMph ?? 0)} mph · ${Math.round(weather.rainChance ?? 0)}%`} />
          </div>
          {weather.impact ? (
            <div className={cn(
              "mt-4 rounded-xl border p-3",
              weather.impact.tone === "positive"
                ? "bg-positive-bg text-positive"
                : weather.impact.tone === "negative"
                  ? "bg-negative-bg text-negative"
                  : "bg-surface-raised text-muted",
            )}>
              <div className="text-xs font-semibold">{weather.impact.label}</div>
              <div className="mt-1 text-[11px] leading-5">{weather.impact.detail}</div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function pickFacingBps(
  bps: number | null | undefined,
  side: MarketOpportunity["recommendedSide"],
) {
  if (bps === null || bps === undefined) return null;
  return side === "no" ? 10_000 - bps : bps;
}

function sourceLabel(source: string) {
  if (source === "fantasypros") return "FantasyPros";
  if (source === "numberfire") return "numberFire";
  if (source === "espn") return "ESPN";
  if (source === "cbs") return "CBS";
  if (source === "fftoday") return "FFToday";
  if (source === "nfl") return "NFL.com";
  if (source === "covers") return "Covers";
  if (source === "dimers") return "Dimers";
  if (source === "rotoballer") return "RotoBaller";
  if (source === "sleeper") return "Sleeper";
  return titleCase(source);
}

function signedPercentFromBps(bps: number) {
  const value = bps / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function ModelInputs({ market }: { market: MarketOpportunity }) {
  const components = market.model.components;
  const sources = components?.projectionSources ?? [];
  const consensusChance = pickFacingBps(
    components?.consensusProbabilityBps,
    market.recommendedSide,
  );
  const statisticalChance = pickFacingBps(
    components?.statisticalProbabilityBps,
    market.recommendedSide,
  );
  const contextAdjustment =
    (components?.contextAdjustmentBps ?? 0) *
    (market.recommendedSide === "no" ? -1 : 1);

  const contextText =
    Math.abs(contextAdjustment) < 25
      ? "No meaningful change"
      : `${signedPercentFromBps(contextAdjustment)} to this bet`;

  return (
    <section className="rounded-2xl border bg-background p-4">
      <h3 className="text-sm font-semibold">How Lynerva got here</h3>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border bg-surface p-3.5">
          <div className="text-xs font-semibold">Outside projections</div>
          {components?.consensusProjection === null ||
          components?.consensusProjection === undefined ? (
            <p className="mt-1.5 text-[11px] leading-5 text-muted">
              Independent weekly projections are unavailable for this stat. Lynerva only publishes the pick when separate current-season evidence is strong enough to support it.
            </p>
          ) : (
            <>
              <div className="mt-1.5 text-[15px] font-semibold">
                {components.consensusProjection.toFixed(2)} projected
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                {consensusChance === null
                  ? "No usable probability was available from the projection sites."
                  : `That works out to about ${formatPercent(consensusChance)} for this bet.`}
              </p>
              {sources.length ? (
                <p className="mt-1 text-[10px] leading-5 text-faint">
                  {sources
                    .map(
                      (source) =>
                        `${sourceLabel(source.source)} ${source.value.toFixed(2)}`,
                    )
                    .join(" · ")}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-xl border bg-surface p-3.5">
          <div className="text-xs font-semibold">This season</div>
          <div className="mt-1.5 text-[15px] font-semibold">
            {statisticalChance === null
              ? `${market.model.evidence.sampleSize} of 4 games`
              : formatPercent(statisticalChance)}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {statisticalChance === null
              ? "Lynerva waits for four current-season games before using player history."
              : "Current-season player history is now part of the estimate."}
          </p>
        </div>

        <div className="rounded-xl border bg-surface p-3.5">
          <div className="text-xs font-semibold">Game conditions</div>
          <div className="mt-1.5 text-[15px] font-semibold">{contextText}</div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Weather and the expected game environment are included here.
          </p>
        </div>
      </div>
    </section>
  );
}

export function BetLab({ market, onClose }: { market: MarketOpportunity; onClose: () => void }) {
  const title = displayMarketTitle(market);
  const subject = market.canonical?.subject ?? "";
  const visuals = usePlayerVisuals(subject ? [subject] : []);
  const count = hitCount(market);
  const profit = profitOn100(market);

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
      localStorage.setItem(
        "lynerva-track-draft",
        JSON.stringify({
          description: `${displayPickSide(market)} · ${title}`,
          platform: market.platform,
          entryPriceBps: market.executablePriceBps,
        }),
      );
    } catch {}
    window.location.href = "/tracker";
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Bet Lab for ${title}`}>
      <button type="button" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-label="Close details" />
      <aside className="sheet-enter scrollbar-subtle absolute inset-x-2 bottom-2 top-[6vh] overflow-y-auto rounded-[24px] border bg-surface shadow-[0_20px_80px_rgb(0_0_0/0.36)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-[620px] sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="sticky top-0 z-10 border-b bg-[var(--header)] px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-start gap-4">
            <SubjectVisual market={market} visual={visuals[subject]} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformMark platform={market.platform} />
                <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[10px] font-semibold text-positive">{displayPickSide(market)}</span>
              </div>
              <h2 className="mt-2 text-lg font-semibold leading-snug">{title}</h2>
              <p className="mt-1 text-xs text-muted">{displayContext(market)}</p>
            </div>
            <ScoreRing score={market.lynervaScore} size={64} />
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-background" aria-label="Close"><X size={17} /></button>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-7">
          <section className="rounded-2xl border bg-background p-4">
            <h3 className="text-sm font-semibold">At a glance</h3>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4 sm:gap-x-6">
              <Metric label="Market" value={formatPercent(market.executablePriceBps)} />
              <Metric label="Lynerva" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
              <Metric label="Hit rate" value={count ? `${Math.round((count.hits / count.games) * 100)}%` : "—"} />
              <Metric label="$100 profit" value={profit === null ? "—" : `${profit.toFixed(0)}`} />
            </div>
            <div className="mt-3 text-[10px] text-faint">
              Current market equivalent: {americanOdds(market.executablePriceBps)}
            </div>
          </section>

          <section className="rounded-2xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Why Lynerva likes it</h3>
            <div className="mt-3 space-y-2 text-xs leading-5 text-muted">
              <p>
                The market is pricing this at about <strong className="text-foreground">{formatPercent(market.executablePriceBps)}</strong>, while Lynerva estimates <strong className="text-foreground">{formatPercent(market.recommendedProbabilityBps)}</strong>.
              </p>
              {count ? <p>In <strong className="text-foreground">2026 only</strong>, it hit in <strong className="text-foreground">{count.hits} of {count.games}</strong> game{count.games === 1 ? "" : "s"}.</p> : null}
              {profit !== null ? <p>At the current price, risking $100 would profit about <strong className="text-foreground">${profit.toFixed(0)}</strong> if it wins.</p> : null}
            </div>
          </section>

          <ModelInputs market={market} />
          <PastPerformance market={market} />
          <WeatherCard market={market} />

          <section className="rounded-2xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Bet details</h3>
            <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
              <div><div className="text-faint">Platform</div><div className="mt-1 font-medium capitalize">{market.platform}</div></div>
              <div><div className="text-faint">Updated</div><div className="mt-1 font-medium">{relativeTime(market.updatedAt)}</div></div>
              <div><div className="text-faint">Lynerva score</div><div className="mt-1 font-medium">{market.lynervaScore ?? "—"} / 100</div></div>
              <div><div className="text-faint">Games in model</div><div className="mt-1 font-medium">{market.model.evidence.sampleSize || "—"}</div></div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={track} className="primary-action rounded-lg px-4 py-2.5 text-xs font-semibold">Track this bet</button>
            <a href={market.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-xs font-semibold">
              Open on {titleCase(market.platform)} <ExternalLink size={12} />
            </a>
          </div>

          <p className="text-[10px] leading-4 text-faint">
            Lynerva Score is a ranking tool, not the chance that the bet wins. Weather is loaded separately so it does not slow the main market feed.
          </p>
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const sorted = markets.toSorted((a, b) => (b.lynervaScore ?? -1) - (a.lynervaScore ?? -1));
    const map = new Map<string, MarketOpportunity[]>();
    for (const market of sorted) {
      const canonical = market.canonical;
      const key = canonical
        ? [canonical.matchup, canonical.family, canonical.subject ?? "", canonical.statistic ?? "", market.recommendedSide ?? ""].join(":")
        : `${market.platform}:${market.platformMarketId}`;
      const group = map.get(key) ?? [];
      group.push(market);
      map.set(key, group);
    }
    const allGroups = [...map.entries()]
      .map(([key, lines]) => ({ key, lines, best: lines[0]! }))
      .toSorted(
        (a, b) => (b.best.lynervaScore ?? -1) - (a.best.lynervaScore ?? -1),
      );

    if (allGroups.length <= 30) return allGroups;

    // Keep the page genuinely useful across the weekly prop board. Pure score
    // sorting can let one deep market family, usually receiving yards, consume
    // every visible slot even when strong reception, QB, or TD opportunities
    // exist. Preserve the top 24 outright, then reserve the remaining space
    // for the best solid setup from any missing family before filling by score.
    const selected = allGroups.slice(0, 24);
    const selectedKeys = new Set(selected.map((group) => group.key));
    const representedFamilies = new Set(
      selected
        .map((group) => group.best.canonical?.family)
        .filter((family): family is NonNullable<typeof family> => Boolean(family)),
    );
    const familyOrder = [
      "passing_yards",
      "passing_touchdowns",
      "passing_interceptions",
      "rushing_yards",
      "receiving_yards",
      "receptions",
      "touchdowns",
    ] as const;

    for (const family of familyOrder) {
      if (selected.length >= 30) break;
      if (representedFamilies.has(family)) continue;
      const candidate = allGroups.find(
        (group) =>
          !selectedKeys.has(group.key) &&
          group.best.canonical?.family === family &&
          (group.best.lynervaScore ?? 0) >= 52,
      );
      if (!candidate) continue;
      selected.push(candidate);
      selectedKeys.add(candidate.key);
      representedFamilies.add(family);
    }

    for (const group of allGroups) {
      if (selected.length >= 30) break;
      if (selectedKeys.has(group.key)) continue;
      selected.push(group);
      selectedKeys.add(group.key);
    }

    return selected.toSorted(
      (a, b) => (b.best.lynervaScore ?? -1) - (a.best.lynervaScore ?? -1),
    );
  }, [markets]);

  const playerNames = useMemo(
    () =>
      groups
        .map(({ best }) => best.canonical?.subject ?? "")
        .filter(Boolean),
    [groups],
  );
  const visuals = usePlayerVisuals(playerNames);

  if (!groups.length) {
    return (
      <div className="premium-panel rounded-2xl px-6 py-16 text-center">
        <p className="font-medium">{emptyMessage}</p>
        <p className="mt-1 text-xs text-muted">Try another filter or check back when markets move.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(({ key, lines, best: market }, index) => {
          const rate = hitRate(market);
          const profit = profitOn100(market);
          const isExpanded = expanded.has(key);
          const alternates = lines.slice(1);

          return (
            <div
              key={key}
              className={cn(
                "pick-card pick-card-enter flex h-full flex-col rounded-2xl border bg-surface text-left",
                scoreTone(market.lynervaScore),
              )}
              style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
            >
              <button
                type="button"
                onClick={() => setSelected(market)}
                className="flex w-full flex-1 flex-col p-4 text-left sm:p-5"
              >
                <div className="flex items-start gap-4 sm:min-h-[116px]">
                  <div className="relative">
                    <SubjectVisual
                      market={market}
                      visual={visuals[market.canonical?.subject ?? ""]}
                    />
                    <span className="rank-badge absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full text-[9px] font-bold">{index + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformMark platform={market.platform} />
                      <span className="opportunity-label rounded-full px-2 py-0.5 text-[9px] font-semibold">
                        {scoreLabel(market.lynervaScore)}
                      </span>
                      {edgeLabel(market) ? (
                        <span className="rounded-full bg-positive-bg px-2 py-0.5 text-[9px] font-semibold text-positive">
                          {edgeLabel(market)}
                        </span>
                      ) : null}
                      {market.isLive ? <span className="live-badge rounded-full bg-negative-bg px-1.5 py-0.5 text-[9px] font-bold uppercase text-negative">Live</span> : null}
                    </div>
                    <div className="mt-2 line-clamp-2 text-[15px] font-semibold leading-6">
                      <span className="mr-1.5 text-positive">{displayPickSide(market)}</span>
                      {displayMarketTitle(market)}
                    </div>
                    <div className="mt-1 text-[11px] text-faint">{displayContext(market)}</div>
                  </div>
                  <ScoreRing score={market.lynervaScore} />
                </div>

                <div className="metric-strip mt-4 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-transparent bg-background p-3.5 sm:grid-cols-4 sm:gap-3">
                  <Metric label="Market" value={formatPercent(market.executablePriceBps)} />
                  <Metric label="Lynerva" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
                  <Metric label="Hit rate" value={rate === null ? "—" : `${rate}%`} />
                  <Metric label="$100 profit" value={profit === null ? "—" : `$${profit.toFixed(0)}`} />
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 pt-3.5 text-[10px] text-muted">
                  <span>{americanOdds(market.executablePriceBps)} equivalent</span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                    <FlaskConical size={11} />
                    Bet Lab
                  </span>
                </div>
              </button>

              {alternates.length ? (
                <div className="border-t">
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })}
                    className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    <span>{alternates.length} alternate line{alternates.length === 1 ? "" : "s"}</span>
                    <ChevronDown size={14} className={cn("transition-transform", isExpanded ? "rotate-180" : "")} />
                  </button>

                  {isExpanded ? (
                    <div className="space-y-1 border-t bg-background p-2">
                      {alternates.map((alt) => {
                        const altProfit = profitOn100(alt);
                        return (
                          <button
                            key={`${alt.platform}:${alt.platformMarketId}:${alt.platformOutcomeId ?? "yes"}`}
                            type="button"
                            onClick={() => setSelected(alt)}
                            className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-left text-[11px] hover:bg-surface-raised"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium"><span className="mr-1 text-positive">{displayPickSide(alt)}</span>{displayMarketTitle(alt)}</div>
                              <div className="mt-0.5 text-faint">{formatPercent(alt.executablePriceBps)} market · {formatPercent(alt.recommendedProbabilityBps)} Lynerva</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold tabular">{alt.lynervaScore ?? "—"}</div>
                              <div className="text-[8px] uppercase text-faint">score</div>
                            </div>
                            <div className="min-w-12 text-right tabular text-muted">
                              {altProfit === null ? "—" : `+$${altProfit.toFixed(0)}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {selected ? <BetLab market={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
