"use client";

import { ChevronDown, CloudSun, ExternalLink, FlaskConical, HeartPulse, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn, formatPercent, relativeTime, titleCase } from "@/lib/utils";
import { PlatformMark } from "./platform-mark";
import { SubjectVisual } from "./subject-visual";
import { usePlayerVisuals } from "./player-visuals";

const FAMILY_LABEL: Record<string, string> = {
  passing_yards: "Passing Yards",
  passing_touchdowns: "Passing TDs",
  rushing_yards: "Rushing Yards",
  rushing_touchdowns: "Rushing TDs",
  receiving_yards: "Receiving Yards",
  receiving_touchdowns: "Receiving TDs",
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

  if (canonical.family === "moneyline") {
    return `${canonical.subject} Moneyline`;
  }

  if (
    canonical.threshold !== null &&
    ["passing_yards","passing_touchdowns","rushing_yards","rushing_touchdowns","receiving_yards","receiving_touchdowns","receptions","longest_reception","touchdowns"].includes(canonical.family)
  ) {
    if (
      ["touchdowns", "rushing_touchdowns", "receiving_touchdowns"].includes(
        canonical.family,
      ) &&
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
  if (market.canonical?.family === "moneyline") return "To win";
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

function historyGameLabel(
  market: MarketOpportunity,
  game: NonNullable<MarketOpportunity["model"]["evidence"]["recentGames"]>[number],
) {
  const family = market.canonical?.family;
  const prefix = [
    `Week ${game.week}`,
    game.team && game.opponent ? `${game.team} vs ${game.opponent}` : null,
  ].filter(Boolean).join(" · ");

  if (family === "rushing_yards") {
    return `${prefix} · ${game.rushingAttempts ?? "?"} rushes · ${game.value} rushing yards`;
  }
  if (family === "receiving_yards") {
    const usage =
      game.targets !== null && game.targets !== undefined
        ? `${game.receptions ?? "?"} catches on ${game.targets} targets`
        : game.receptions !== null && game.receptions !== undefined
          ? `${game.receptions} catches`
          : null;
    return [prefix, usage, `${game.value} receiving yards`].filter(Boolean).join(" · ");
  }
  if (family === "receptions") {
    const targets =
      game.targets !== null && game.targets !== undefined
        ? ` on ${game.targets} targets`
        : "";
    return `${prefix} · ${game.value} receptions${targets}`;
  }
  if (family === "passing_yards") {
    const attempts =
      game.passingAttempts !== null && game.passingAttempts !== undefined
        ? `${game.passingAttempts} pass attempts · `
        : "";
    return `${prefix} · ${attempts}${game.value} passing yards`;
  }
  if (family === "passing_touchdowns") {
    const attempts =
      game.passingAttempts !== null && game.passingAttempts !== undefined
        ? `${game.passingAttempts} pass attempts · `
        : "";
    return `${prefix} · ${attempts}${game.value} passing TD${game.value === 1 ? "" : "s"}`;
  }
  if (family === "touchdowns" || family === "rushing_touchdowns" || family === "receiving_touchdowns") {
    const usage = [
      game.rushingAttempts !== null && game.rushingAttempts !== undefined
        ? `${game.rushingAttempts} rushes`
        : null,
      game.targets !== null && game.targets !== undefined
        ? `${game.targets} targets`
        : null,
    ].filter(Boolean).join(" · ");
    return [prefix, usage, `${game.value} TD${game.value === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  }
  if (family === "passing_interceptions") {
    return `${prefix} · ${game.value} interception${game.value === 1 ? "" : "s"}`;
  }

  return `${prefix} · ${game.value}`;
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

function ScoreMovementBadge({
  market,
  compact = false,
}: {
  market: MarketOpportunity;
  compact?: boolean;
}) {
  const movement = market.scoreMovement;
  if (!movement || Math.abs(movement.delta) < 2) return null;
  const positive = movement.delta > 0;

  return (
    <span
      title={movement.detail}
      className={cn(
        "inline-flex items-center justify-center rounded-full border font-semibold tabular",
        compact ? "mt-1 px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[10px]",
        positive
          ? "border-positive/20 bg-positive-bg text-positive"
          : "border-negative/20 bg-negative-bg text-negative",
      )}
    >
      {positive ? "+" : ""}
      {movement.delta} refresh
    </span>
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

  if (market.canonical?.family === "moneyline") {
    const evidence = market.model.evidence;
    const games = evidence.seasonGames ?? evidence.sampleSize;
    const wins = evidence.seasonHits;
    return (
      <section className="rounded-2xl border bg-background p-4">
        <h3 className="text-sm font-semibold">2026 team form</h3>
        {games > 0 && wins !== null ? (
          <>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-2xl font-bold tabular">{wins} wins</span>
              <span className="pb-0.5 text-[10px] text-muted">
                in {games} regular-season game{games === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              Huddlemark uses only completed 2026 regular-season games for team form. Older seasons, preseason, and playoffs are excluded.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted">
            No completed 2026 regular-season team sample is available yet.
          </p>
        )}
      </section>
    );
  }

  if (!values.length || threshold === null) {
    return (
      <section className="rounded-2xl border bg-background p-4">
        <h3 className="text-sm font-semibold">Past performance</h3>
        <p className="mt-2 text-xs text-muted">Not enough comparable regular-season history is available for this market.</p>
      </section>
    );
  }

  const detailed =
    market.model.evidence.recentGames?.slice(0, 10) ??
    values.slice(0, 10).map((value, index) => ({
      season: 2026,
      week: Math.max(1, values.length - index),
      value,
    }));
  const recent = detailed.toReversed();
  const maxValue = Math.max(...recent.map((game) => game.value), threshold, 1);
  const chartMax = Math.max(maxValue * 1.14, threshold * 1.14, 1);
  const thresholdPct = Math.min(100, Math.max(0, (threshold / chartMax) * 100));

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

      <div className="relative h-32">
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-accent/70"
          style={{ bottom: `${thresholdPct}%` }}
        >
          <span className="absolute -top-4 left-0 rounded bg-background px-1.5 py-0.5 text-[8px] font-semibold text-accent">
            Need {threshold}
          </span>
        </div>
        <div className="flex h-full items-end gap-1.5">
          {recent.map((game) => {
            const hit = didPickHit(market, game.value);
            const tooltip = historyGameLabel(market, game);
            return (
              <div
                key={`${game.season}:${game.week}`}
                className="group relative flex h-full min-w-0 flex-1 items-end"
                title={tooltip}
              >
                <div
                  className={cn(
                    "w-full rounded-t-md transition-opacity group-hover:opacity-80",
                    hit ? "bg-positive" : "bg-border-strong",
                  )}
                  style={{ height: `${Math.max(5, (game.value / chartMax) * 100)}%` }}
                />
                <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border bg-surface px-2.5 py-2 text-[9px] leading-4 text-foreground shadow-lg group-hover:block">
                  {tooltip}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        {recent.map((game) => (
          <div key={`label:${game.season}:${game.week}`} className="min-w-0 flex-1 text-center">
            <p className="text-[8px] font-semibold uppercase tracking-[0.04em] text-muted">W{game.week}</p>
            <p className="mt-0.5 text-[8px] tabular text-faint">{game.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-positive" /> Hit</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-border-strong" /> Miss</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-accent" /> Market line</span>
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
  const matchup = market.canonical?.matchup;
  const canLoad = Boolean(matchup && market.canonical);
  const [loading, setLoading] = useState(canLoad);

  useEffect(() => {
    if (!matchup || !market.canonical) return;

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

function LiveCheckpoint({ market }: { market: MarketOpportunity }) {
  const components = market.model.components;
  const current = components?.liveCurrentValue ?? null;
  const projected = components?.liveProjectedFinal ?? null;
  const remaining = components?.liveRemainingFraction ?? null;
  const threshold = market.canonical?.threshold ?? null;
  const subject = market.canonical?.subject ?? "The player";
  const pick = displayPickSide(market);

  if (!market.isLive) return null;

  if (current === null || threshold === null) {
    return (
      <section className="rounded-2xl border border-warning/25 bg-warning-bg p-4">
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-warning">
          Live checkpoint
        </p>
        <h3 className="mt-2 text-sm font-semibold">
          Current player stat unavailable
        </h3>
        <p className="mt-2 text-xs leading-5 text-muted">
          Huddlemark will not explain this pick with a stale pregame stat.
          Reopen the card after the next live-data refresh.
        </p>
      </section>
    );
  }

  const over = pick === "Over" || pick === "Yes";
  const gap = threshold - current;
  const projectedMargin = projected === null ? null : projected - threshold;
  const gameComplete =
    remaining === null ? null : Math.round((1 - remaining) * 100);
  const progress = Math.max(
    0,
    Math.min(100, threshold === 0 ? 100 : (current / threshold) * 100),
  );
  const neededText = over
    ? gap <= 0
      ? "Already past the line"
      : gap.toFixed(1) + " more"
    : gap <= 0
      ? "Already past the line"
      : "Fewer than " + gap.toFixed(1) + " more";
  const projectionExplanation =
    projectedMargin === null
      ? "The model is using the current " +
        current.toFixed(1) +
        " plus the time left, but a stable final projection is not ready yet."
      : "Based on the current pace and time left, Huddlemark projects " +
        projected!.toFixed(1) +
        "—" +
        Math.abs(projectedMargin).toFixed(1) +
        (projectedMargin >= 0 ? " above " : " below ") +
        "the line. That live path is why the model currently prefers " +
        pick.toLowerCase() +
        ".";

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/25 bg-background">
      <div className="border-b bg-accent-bg/55 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
              Live checkpoint
            </p>
            <h3 className="mt-1 text-base font-semibold">
              {subject} has {current.toFixed(1)} right now.
            </h3>
          </div>
          <span className="rounded-full border bg-surface px-2.5 py-1 text-[10px] font-semibold">
            {gameComplete === null
              ? "Game in progress"
              : gameComplete + "% complete"}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: String(progress) + "%" }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[9px] text-faint">
          <span>Current {current.toFixed(1)}</span>
          <span>Line {threshold}</span>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <p className="text-[9px] uppercase tracking-[0.08em] text-faint">
            What is needed
          </p>
          <p className="mt-1 text-sm font-semibold">{neededText}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-[0.08em] text-faint">
            Projected finish
          </p>
          <p className="mt-1 text-sm font-semibold">
            {projected === null ? "Still calculating" : projected.toFixed(1)}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-[0.08em] text-faint">
            Model vs market
          </p>
          <p className="mt-1 text-sm font-semibold text-positive">
            {formatPercent(market.recommendedProbabilityBps)} vs{" "}
            {formatPercent(market.executablePriceBps)}
          </p>
        </div>
      </div>
      <p className="border-t px-4 py-3 text-[11px] leading-5 text-muted">
        {projectionExplanation}
      </p>
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

function InjuryRiskCard({ market }: { market: MarketOpportunity }) {
  const components = market.model.components;
  const risk = components?.injuryRisk ?? null;
  const play = components?.injuryPlayProbabilityBps ?? null;
  const finish = components?.injuryFinishProbabilityBps ?? null;
  const fullRole = components?.injuryFullRoleProbabilityBps ?? null;

  if (!risk || play === null || market.isLive) return null;

  const preInjury = pickFacingBps(
    components?.preInjuryProbabilityBps,
    market.recommendedSide,
  );
  const adjusted = market.recommendedProbabilityBps;
  const probabilityImpact =
    preInjury !== null && adjusted !== null ? adjusted - preInjury : null;
  const baseProjection = components?.consensusProjection ?? null;
  const adjustedProjection = components?.injuryAdjustedProjection ?? null;
  const sources = components?.injurySources ?? [];
  const riskTone =
    risk === "out" || risk === "high"
      ? "border-negative/30 bg-negative-bg/55 text-negative"
      : risk === "medium"
        ? "border-warning/30 bg-warning-bg/55 text-warning"
        : "border-positive/25 bg-positive-bg/45 text-positive";
  const riskLabel =
    risk === "out"
      ? "Ruled out risk"
      : risk === "high"
        ? "High availability risk"
        : risk === "medium"
          ? "Meaningful availability risk"
          : "Low availability risk";

  return (
    <section className="overflow-hidden rounded-2xl border bg-background">
      <div className={cn("border-b p-4", riskTone)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface/70">
              <HeartPulse className="size-4" />
            </span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em]">
                Injury availability
              </p>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                {components?.injuryStatus ?? "Injury listed"}
                {components?.injuryBodyPart
                  ? " · " + components.injuryBodyPart
                  : ""}
              </h3>
            </div>
          </div>
          <span className="rounded-full border bg-surface/75 px-2.5 py-1 text-[9px] font-semibold">
            {riskLabel}
          </span>
        </div>
        {components?.injuryDetail ? (
          <p className="mt-3 text-[11px] leading-5 text-foreground/75">
            {components.injuryDetail}
          </p>
        ) : null}
        {components?.injuryPracticeParticipation ? (
          <p className="mt-1 text-[10px] text-foreground/65">
            Practice: {components.injuryPracticeParticipation}
          </p>
        ) : null}
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border bg-surface p-3">
            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
              Play chance
            </p>
            <p className="mt-1 text-lg font-semibold tabular">
              {formatPercent(play)}
            </p>
          </div>
          <div className="rounded-xl border bg-surface p-3">
            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
              Finish if active
            </p>
            <p className="mt-1 text-lg font-semibold tabular">
              {finish === null ? "—" : formatPercent(finish)}
            </p>
          </div>
          <div className="rounded-xl border bg-surface p-3">
            <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
              Full-role chance
            </p>
            <p className="mt-1 text-lg font-semibold tabular">
              {fullRole === null ? "—" : formatPercent(fullRole)}
            </p>
          </div>
        </div>

        {baseProjection !== null && adjustedProjection !== null ? (
          <div className="mt-3 rounded-xl border bg-surface-raised/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                  Projection after availability risk
                </p>
                <p className="mt-1 text-sm font-semibold tabular">
                  {baseProjection.toFixed(1)} full-role →{" "}
                  {adjustedProjection.toFixed(1)} expected
                </p>
              </div>
              {probabilityImpact !== null ? (
                <div className="text-right">
                  <p className="text-[8px] uppercase tracking-[0.08em] text-faint">
                    Bet probability impact
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm font-semibold tabular",
                      probabilityImpact < 0
                        ? "text-negative"
                        : probabilityImpact > 0
                          ? "text-positive"
                          : "",
                    )}
                  >
                    {probabilityImpact >= 0 ? "+" : ""}
                    {(probabilityImpact / 100).toFixed(1)}pp
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="mt-3 text-[10px] leading-5 text-muted">
          Huddlemark first estimates whether the player appears at all, then the
          chance of maintaining a near-normal role if active. If the player takes
          a snap, early-exit and reduced-role risk affect the stat projection. A
          true Kalshi DNP is not treated as an automatic loss because those
          markets can settle at an Exchange-determined fair value.
        </p>
        {components?.injuryDnpSettlementBps !== null &&
        components?.injuryDnpSettlementBps !== undefined ? (
          <div className="mt-2 flex items-center justify-between rounded-lg border bg-surface px-3 py-2 text-[9px]">
            <span className="text-muted">Estimated DNP fair-value branch</span>
            <span className="font-semibold tabular">
              {formatPercent(components.injuryDnpSettlementBps)}
            </span>
          </div>
        ) : null}
        {sources.length ? (
          <p className="mt-2 text-[9px] text-faint">
            Injury signals: {sources.join(" + ")}. Structured status, practice
            data, and recent public injury reporting are blended when available.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function sourceLabel(source: string) {
  if (source === "nflverse_current_season_scoring") return "nflverse scoring";
  if (source === "current_season_league_baseline") return "2026 league baseline";
  if (source === "nflverse_current_season_record") return "nflverse record";
  if (source === "espn_fpi") return "ESPN FPI";
  if (source === "espn_live_win_probability") return "ESPN live win model";
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

  if (market.canonical?.family === "moneyline") {
    const gameSources = components?.gameProjectionSources ?? [];
    const sourceWeights = components?.gameProjectionSourceWeights ?? [];
    const weightBySource = new Map(
      sourceWeights.map((row) => [row.source, row.weightBps]),
    );
    const injuryScenarios = components?.moneylineInjuryScenarios ?? [];
    const statisticalChance = pickFacingBps(
      components?.statisticalProbabilityBps,
      market.recommendedSide,
    );
    const teamGames = components?.currentSeasonTeamGames;
    const marketChance = market.executablePriceBps;
    const lynervaChance = market.recommendedProbabilityBps;
    const maxBar = Math.max(marketChance ?? 0, lynervaChance ?? 0, 1);

    return (
      <section className="overflow-hidden rounded-2xl border bg-background">
        <div className="border-b bg-[linear-gradient(135deg,var(--accent-bg),transparent_72%)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-accent">
                Win model
              </div>
              <h3 className="mt-1 text-sm font-semibold">How Huddlemark sees this game</h3>
            </div>
            <div className="rounded-full border bg-surface px-2.5 py-1 text-[9px] font-medium text-muted">
              {gameSources.length} signal{gameSources.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border bg-surface/80 p-3">
              <div className="text-[9px] uppercase tracking-[0.08em] text-faint">Kalshi</div>
              <div className="mt-1 text-xl font-bold tabular">{formatPercent(marketChance)}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-border-strong"
                  style={{ width: `${Math.max(4, ((marketChance ?? 0) / maxBar) * 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-positive/25 bg-positive-bg/45 p-3">
              <div className="text-[9px] uppercase tracking-[0.08em] text-positive">Huddlemark</div>
              <div className="mt-1 text-xl font-bold tabular text-positive">{formatPercent(lynervaChance)}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-positive"
                  style={{ width: `${Math.max(4, ((lynervaChance ?? 0) / maxBar) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {gameSources.map((source) => (
              <div
                key={source.source}
                className="flex items-center justify-between gap-3 rounded-xl border bg-surface px-3 py-2.5"
              >
                <span className="text-[10px] text-muted">{sourceLabel(source.source)}</span>
                <span className="text-right">
                  <span className="block text-xs font-semibold tabular">
                    {formatPercent(
                      pickFacingBps(source.probabilityBps, market.recommendedSide),
                    )}
                  </span>
                  {weightBySource.has(source.source) ? (
                    <span className="block text-[8px] text-faint">
                      {((weightBySource.get(source.source) ?? 0) / 100).toFixed(0)}% weight
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>

          {injuryScenarios.length ? (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold text-amber-300">Roster scenarios</span>
                <span className="text-[9px] text-faint">
                  −{((components?.moneylineInjuryReliabilityPenaltyBps ?? 0) / 100).toFixed(1)}pp reliability
                </span>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-muted">
                Internal scoring moved from {formatPercent(pickFacingBps(components?.moneylineBaselineProbabilityBps, market.recommendedSide))} to {formatPercent(pickFacingBps(components?.moneylineInjuryAdjustedProbabilityBps, market.recommendedSide))}. ESPN stayed raw.
              </p>
              <div className="mt-2 space-y-1.5">
                {injuryScenarios.slice(0, 3).map((scenario) => (
                  <p key={`${scenario.team}:${scenario.player}`} className="text-[9px] leading-4 text-faint">
                    <strong className="text-foreground">{scenario.player}</strong> · {(scenario.playProbabilityBps / 100).toFixed(0)}% to play · {formatPercent(pickFacingBps(scenario.activeWinProbabilityBps, market.recommendedSide))} if active / {formatPercent(pickFacingBps(scenario.inactiveWinProbabilityBps, market.recommendedSide))} if out
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border bg-surface-raised/35 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold">2026 scoring model</span>
              <span className="text-xs font-semibold tabular">
                {statisticalChance === null ? "—" : formatPercent(statisticalChance)}
              </span>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted">
              {teamGames
                ? `${teamGames.subject} completed game${teamGames.subject === 1 ? "" : "s"} for this team · ${teamGames.opponent} for its opponent · regular season only`
                : "Early-season sample is incomplete, so this signal stays low-confidence."}
            </p>
          </div>

          <p className="mt-3 text-[9px] leading-4 text-faint">
            ESPN and current-season team data create the probability independently. Kalshi is used only afterward to measure price and edge.
          </p>
        </div>
      </section>
    );
  }
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
  const teammateProjectionAdjustment =
    components?.teammateContextAdjustment ?? 0;
  const rawConsensusProjection =
    components?.rawConsensusProjection ?? components?.consensusProjection ?? null;

  const teammateAdjustmentDigits =
    market.canonical?.family === "receptions" ? 1 : 0;
  const teammateAdjustmentLabel =
    (teammateProjectionAdjustment > 0 ? "+" : "") +
    teammateProjectionAdjustment.toFixed(teammateAdjustmentDigits);
  const contextText =
    Math.abs(teammateProjectionAdjustment) > 0.05
      ? `${teammateAdjustmentLabel} projection adjustment from teammate availability`
      : Math.abs(contextAdjustment) < 25
        ? "No meaningful change"
        : `${signedPercentFromBps(contextAdjustment)} to this bet`;

  return (
    <section className="rounded-2xl border bg-background p-4">
      <h3 className="text-sm font-semibold">How Huddlemark got here</h3>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border bg-surface p-3.5">
          <div className="text-xs font-semibold">Outside projections</div>
          {components?.consensusProjection === null ||
          components?.consensusProjection === undefined ? (
            <p className="mt-1.5 text-[11px] leading-5 text-muted">
              Independent weekly projections are unavailable for this stat. Huddlemark only publishes the pick when separate current-season evidence is strong enough to support it.
            </p>
          ) : (
            <>
              <div className="mt-1.5 text-[15px] font-semibold">
                {components.consensusProjection.toFixed(2)} projected
                {market.canonical?.threshold !== null &&
                market.canonical?.threshold !== undefined
                  ? ` vs ${market.canonical.threshold} line`
                  : ""}
              </div>
              {Math.abs(teammateProjectionAdjustment) > 0.05 &&
              rawConsensusProjection !== null ? (
                <p className="mt-1 text-[10px] leading-4 text-accent">
                  Raw source consensus {rawConsensusProjection.toFixed(2)} · teammate
                  availability {teammateAdjustmentLabel}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] leading-5 text-muted">
                {market.canonical?.threshold !== null &&
                market.canonical?.threshold !== undefined &&
                market.canonical.threshold !== 0
                  ? `The source consensus is ${Math.abs(
                      ((components.consensusProjection -
                        market.canonical.threshold) /
                        market.canonical.threshold) *
                        100,
                    ).toFixed(0)}% ${components.consensusProjection >= market.canonical.threshold ? "above" : "below"} the listed line. `
                  : ""}
                {consensusChance === null
                  ? "No usable probability was available from the projection sites."
                  : `After applying the stat distribution, that maps to about a ${formatPercent(consensusChance)} chance for this side.`}
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
              {components?.projectionStdDev !== null &&
              components?.projectionStdDev !== undefined ? (
                <p className="mt-1 text-[10px] leading-5 text-faint">
                  Expected game-to-game SD {components.projectionStdDev.toFixed(1)}
                  {components.projectionStdDevPrior !== null &&
                  components.projectionStdDevPrior !== undefined
                    ? ` · 2025 projection/position prior ${components.projectionStdDevPrior.toFixed(1)}`
                    : ""}
                  {(components.projectionStdDevPlayerWeight ?? 0) > 0
                    ? ` · ${Math.round(
                        (components.projectionStdDevPlayerWeight ?? 0) * 100,
                      )}% player-specific 2026 variance`
                    : ""}
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
              ? "Huddlemark waits for four current-season games before using player history."
              : "Current-season player history is now part of the estimate."}
          </p>
        </div>

        <div className="rounded-xl border bg-surface p-3.5">
          <div className="text-xs font-semibold">Game conditions</div>
          <div className="mt-1.5 text-[15px] font-semibold">{contextText}</div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Weather, expected game environment, and newly available teammate
            injury information are included here. Teammate adjustments are
            reduced when projection sources appear to have already moved after
            the news.
          </p>
          {components?.teammateContextNotes?.length ? (
            <div className="mt-2 space-y-1 text-[10px] leading-4 text-faint">
              {components.teammateContextNotes.slice(0, 3).map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function BetLab({ market, onClose }: { market: MarketOpportunity; onClose: () => void }) {
  const router = useRouter();
  const title = displayMarketTitle(market);
  const subject = market.canonical?.subject ?? "";
  const visuals = usePlayerVisuals(subject ? [subject] : []);
  const count = hitCount(market);
  const profit = profitOn100(market);
  const edgeBps =
    market.recommendedProbabilityBps !== null &&
    market.executablePriceBps !== null
      ? market.recommendedProbabilityBps - market.executablePriceBps
      : null;
  const relativeEdge =
    edgeBps !== null &&
    market.executablePriceBps !== null &&
    market.executablePriceBps > 0
      ? edgeBps / market.executablePriceBps
      : null;

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
          platformMarketId: market.platformMarketId,
          recommendedSide: market.recommendedSide,
          entryPriceBps: market.executablePriceBps,
          isLive: market.isLive,
        }),
      );
    } catch {}
    router.push("/tracker");
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Bet Lab for ${title}`}>
      <button type="button" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-label="Close details" />
      <aside className="bet-lab-sheet sheet-enter scrollbar-subtle absolute inset-x-2 bottom-2 top-[6vh] overflow-y-auto rounded-[24px] border bg-surface shadow-[0_20px_80px_rgb(0_0_0/0.36)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-[620px] sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="bet-lab-hero sticky top-0 z-10 border-b bg-[var(--header)] px-5 py-4 backdrop-blur-xl sm:px-7">
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
            <div className="flex shrink-0 flex-col items-center">
              <ScoreRing score={market.lynervaScore} size={64} />
              <ScoreMovementBadge market={market} compact />
            </div>
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-background" aria-label="Close"><X size={17} /></button>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-7">
          {market.scoreMovement && Math.abs(market.scoreMovement.delta) >= 2 ? (
            <section className="rounded-2xl border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">What changed</h3>
                <ScoreMovementBadge market={market} />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                {market.scoreMovement.detail}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-faint">
                {market.scoreMovement.priceDeltaBps !== null ? (
                  <span>
                    Market price {market.scoreMovement.priceDeltaBps > 0 ? "+" : ""}
                    {(market.scoreMovement.priceDeltaBps / 100).toFixed(1)}pp
                  </span>
                ) : null}
                {market.scoreMovement.probabilityDeltaBps !== null ? (
                  <span>
                    Huddlemark probability {market.scoreMovement.probabilityDeltaBps > 0 ? "+" : ""}
                    {(market.scoreMovement.probabilityDeltaBps / 100).toFixed(1)}pp
                  </span>
                ) : null}
                {market.scoreMovement.projectionSourceCountDelta !== 0 ? (
                  <span>
                    Projection sources {market.scoreMovement.projectionSourceCountDelta > 0 ? "+" : ""}
                    {market.scoreMovement.projectionSourceCountDelta}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <LiveCheckpoint market={market} />
          <InjuryRiskCard market={market} />

          <section className="rounded-2xl border bg-background p-4">
            <h3 className="text-sm font-semibold">At a glance</h3>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
              <Metric label="Market chance" value={formatPercent(market.executablePriceBps)} />
              <Metric label="Model chance" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
              <Metric
                label="Edge"
                value={edgeBps === null ? "—" : `${edgeBps >= 0 ? "+" : ""}${(edgeBps / 100).toFixed(1)}pp`}
                emphasis
              />
              <Metric label="Hit rate" value={count ? `${Math.round((count.hits / count.games) * 100)}%` : "—"} />
              <Metric label="$100 profit" value={profit === null ? "—" : `${profit.toFixed(0)}`} />
            </div>
            <div className="mt-3 text-[10px] text-faint">
              Current market equivalent: {americanOdds(market.executablePriceBps)}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-background">
            <div className="border-b bg-[linear-gradient(135deg,var(--accent-bg),transparent_70%)] p-4">
              <h3 className="text-sm font-semibold">Why Huddlemark likes it</h3>
              {edgeBps !== null ? (
                <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <span className="text-2xl font-bold tabular text-positive">
                    {edgeBps >= 0 ? "+" : ""}{(edgeBps / 100).toFixed(1)}pp
                  </span>
                  <span className="pb-0.5 text-[10px] font-medium text-muted">
                    model-versus-market edge
                  </span>
                </div>
              ) : null}
            </div>
            <div className="space-y-2 p-4 text-xs leading-5 text-muted">
              <p>
                <strong className="text-foreground">Market chance</strong> is the
                probability implied by the current price:{" "}
                <strong className="text-foreground">{formatPercent(market.executablePriceBps)}</strong>.
                Huddlemark estimates this side at{" "}
                <strong className="text-foreground">{formatPercent(market.recommendedProbabilityBps)}</strong>.
              </p>
              {edgeBps !== null ? (
                <p>
                  The difference is{" "}
                  <strong className="text-foreground">
                    {Math.abs(edgeBps / 100).toFixed(1)} percentage points
                  </strong>
                  . &ldquo;pp&rdquo; means percentage points, not percent.{" "}
                  {relativeEdge !== null && relativeEdge > 0
                    ? `Relative to the market-implied chance, Huddlemark's estimate is about ${(relativeEdge * 100).toFixed(0)}% higher.`
                    : "A negative edge means the current price is richer than Huddlemark's estimate."}
                </p>
              ) : null}
              {count ? (
                <p>
                  In <strong className="text-foreground">2026 only</strong>, this
                  side hit in{" "}
                  <strong className="text-foreground">{count.hits} of {count.games}</strong>{" "}
                  game{count.games === 1 ? "" : "s"}.
                </p>
              ) : null}
              {profit !== null ? (
                <p>
                  At the current price, risking $100 would profit about{" "}
                  <strong className="text-foreground">${profit.toFixed(0)}</strong>{" "}
                  if it wins. That payout is considered together with hit chance,
                  not treated as upside by itself.
                </p>
              ) : null}
            </div>
          </section>

          <ModelInputs market={market} />
          <PastPerformance market={market} />
          <WeatherCard key={market.platformMarketId} market={market} />

          <section className="rounded-2xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Bet details</h3>
            <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
              <div><div className="text-faint">Platform</div><div className="mt-1 font-medium capitalize">{market.platform}</div></div>
              <div><div className="text-faint">Updated</div><div className="mt-1 font-medium">{relativeTime(market.updatedAt)}</div></div>
              <div><div className="text-faint">Pick score</div><div className="mt-1 font-medium">{market.lynervaScore ?? "—"} / 100</div></div>
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
            Pick Score ranks opportunities; it is not the chance that the bet wins. Weather loads separately so it does not slow the main board.
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
  const [alternateGroup, setAlternateGroup] = useState<{ key: string; lines: MarketOpportunity[] } | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);

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

    // The board is a pure score ranking. Stat-family differences belong in
    // probability calibration, never in forced leaderboard slots.
    return allGroups.slice(0, 30);
  }, [markets]);

  const playerNames = useMemo(
    () =>
      groups
        .slice(0, visibleCount)
        .map(({ best }) => best.canonical?.subject ?? "")
        .filter(Boolean),
    [groups, visibleCount],
  );
  const visuals = usePlayerVisuals(playerNames);
  const visibleGroups = groups.slice(0, visibleCount);

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
        {visibleGroups.map(({ key, lines, best: market }, index) => {
          const rate = hitRate(market);
          const profit = profitOn100(market);
          const alternates = lines.slice(1);

          return (
            <div
              key={key}
              className={cn(
                "pick-card pick-card-enter relative flex h-full flex-col rounded-2xl border bg-surface text-left",
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
                      {!market.isLive &&
                      market.model.components?.injuryRisk &&
                      market.model.components.injuryRisk !== "low" ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                            market.model.components.injuryRisk === "high" ||
                            market.model.components.injuryRisk === "out"
                              ? "bg-negative-bg text-negative"
                              : "bg-warning-bg text-warning",
                          )}
                        >
                          Injury risk
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 line-clamp-2 text-[15px] font-semibold leading-6">
                      <span className="mr-1.5 text-positive">{displayPickSide(market)}</span>
                      {displayMarketTitle(market)}
                    </div>
                    <div className="mt-1 text-[11px] text-faint">{displayContext(market)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center">
                    <ScoreRing score={market.lynervaScore} />
                    <ScoreMovementBadge market={market} compact />
                  </div>
                </div>

                <div className="metric-strip mt-4 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-transparent bg-background p-3.5 sm:grid-cols-4 sm:gap-3">
                  <Metric label="Market" value={formatPercent(market.executablePriceBps)} />
                  <Metric label="Model" value={formatPercent(market.recommendedProbabilityBps)} emphasis />
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
                    onClick={() => setAlternateGroup({ key, lines: alternates })}
                    className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    <span>{alternates.length} alternate line{alternates.length === 1 ? "" : "s"}</span>
                    <ChevronDown size={14} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {visibleGroups.length < groups.length ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setVisibleCount((count) => Math.min(count + 12, groups.length))}
            className="h-11 rounded-xl border bg-surface px-5 text-xs font-semibold transition-colors hover:border-border-strong hover:bg-surface-raised"
          >
            Show 12 more
          </button>
          <span className="text-[10px] text-faint">
            Showing {visibleGroups.length} of {groups.length} ranked picks
          </span>
        </div>
      ) : null}

      {alternateGroup ? (
        <div className="fixed inset-0 z-[65] grid place-items-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="Alternate lines">
          <button type="button" className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={() => setAlternateGroup(null)} aria-label="Close alternate lines" />
          <div className="sheet-enter relative z-10 w-full max-w-[680px] overflow-hidden rounded-[24px] border bg-surface shadow-[0_28px_100px_rgb(0_0_0/0.5)]">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Alternate lines</div>
                <div className="mt-1 text-sm font-semibold">{displayContext(alternateGroup.lines[0]!)}</div>
              </div>
              <button type="button" onClick={() => setAlternateGroup(null)} className="grid size-9 place-items-center rounded-full border bg-background text-muted hover:text-foreground" aria-label="Close alternate lines"><X size={15} /></button>
            </div>
            <div className="scrollbar-subtle max-h-[min(68vh,620px)] space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
              {alternateGroup.lines.map((alt) => {
                const altProfit = profitOn100(alt);
                return (
                  <button
                    key={`${alt.platform}:${alt.platformMarketId}:${alt.platformOutcomeId ?? "yes"}`}
                    type="button"
                    onClick={() => { setSelected(alt); setAlternateGroup(null); }}
                    className="group flex w-full items-center gap-4 rounded-2xl border bg-background p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-raised sm:p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold">
                        <span className="mr-1.5 text-positive">{displayPickSide(alt)}</span>
                        {alt.canonical?.threshold ?? displayMarketTitle(alt)}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        {formatPercent(alt.executablePriceBps)} market · <span className="font-medium text-positive">{formatPercent(alt.recommendedProbabilityBps)} model</span>
                      </div>
                      <div className="mt-2 text-[11px] text-muted">
                        $100 profit <span className="font-semibold tabular text-foreground">{altProfit === null ? "—" : `${altProfit.toFixed(0)}`}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <ScoreRing score={alt.lynervaScore} size={56} />
                      <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-faint">Score</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {selected ? <BetLab market={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
