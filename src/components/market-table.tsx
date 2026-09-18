"use client";

import { CloudSun, ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent, relativeTime, titleCase } from "@/lib/utils";
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
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--positive) ${value * 3.6}deg, var(--border) 0deg)`,
      }}
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

  const initials =
    subject
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
          <span
            key={team}
            className={cn(
              "grid size-5 place-items-center rounded-full border bg-surface p-0.5",
              index ? "-ml-1.5" : "",
            )}
          >
            <img loading="lazy" src={teamLogo(team)} alt="" className="size-full object-contain" />
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular", emphasis ? "text-positive" : "")}>{value}</div>
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

function BetLab({ market, onClose }: { market: MarketOpportunity; onClose: () => void }) {
  const title = displayMarketTitle(market);
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
      <aside className="sheet-enter scrollbar-subtle absolute inset-y-0 right-0 w-full overflow-y-auto border-l bg-surface shadow-[0_0_70px_rgb(0_0_0/0.2)] sm:max-w-[620px]">
        <div className="sticky top-0 z-10 border-b bg-[var(--header)] px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-start gap-4">
            <SubjectVisual market={market} />
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
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Market chance" value={formatPercent(market.executablePriceBps)} />
              <Metric label="Lynerva chance" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
              <Metric label="Recent hit rate" value={count ? `${Math.round((count.hits / count.games) * 100)}%` : "—"} />
              <Metric label="$100 win profit" value={profit === null ? "—" : `$${profit.toFixed(0)}`} />
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
            <button type="button" onClick={track} className="rounded-lg bg-foreground px-4 py-2.5 text-xs font-semibold text-background">Track this bet</button>
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
  const ranked = useMemo(
    () => markets.toSorted((a, b) => (b.lynervaScore ?? -1) - (a.lynervaScore ?? -1)),
    [markets],
  );

  if (!ranked.length) {
    return (
      <div className="rounded-xl border bg-surface px-6 py-16 text-center">
        <p className="font-medium">{emptyMessage}</p>
        <p className="mt-1 text-xs text-muted">Try another filter or check back when markets move.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ranked.map((market, index) => {
          const key = `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
          const rate = hitRate(market);
          const profit = profitOn100(market);

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
                  <div className="flex items-center gap-2">
                    <PlatformMark platform={market.platform} />
                    {market.isLive ? <span className="rounded-full bg-negative-bg px-1.5 py-0.5 text-[9px] font-bold uppercase text-negative">Live</span> : null}
                  </div>
                  <div className="mt-2 line-clamp-2 font-semibold leading-5">
                    <span className="mr-1.5 text-positive">{displayPickSide(market)}</span>
                    {displayMarketTitle(market)}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">{displayContext(market)}</div>
                </div>
                <ScoreRing score={market.lynervaScore} />
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl bg-background p-3">
                <Metric label="Market chance" value={formatPercent(market.executablePriceBps)} />
                <Metric label="Lynerva chance" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
                <Metric label="Hit rate" value={rate === null ? "—" : `${rate}%`} />
                <Metric label="$100 profit" value={profit === null ? "—" : `$${profit.toFixed(0)}`} />
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                <span>{americanOdds(market.executablePriceBps)} equivalent</span>
                <span>Open Bet Lab →</span>
              </div>
            </button>
          );
        })}
      </div>

      {selected ? <BetLab market={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
