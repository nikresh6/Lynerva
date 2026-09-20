"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { MarketOpportunity, Platform, ScoreMovement } from "@/lib/markets/types";

export interface ProviderSummary {
  provider: Platform;
  count: number;
  fetchedAt: string;
  error: string | null;
}

interface MarketClientPayload {
  opportunities: MarketOpportunity[];
  providers: ProviderSummary[];
  ratedCount: number;
  displayedCount: number;
  fetchedAt: string;
}

interface MarketDataContextValue extends MarketClientPayload {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

const STORAGE_KEY = "lynerva-market-snapshot-v6";
// Only hydrate from a very recent browser snapshot. A 30-minute cache made
// cards appear to "randomly" jump seconds after page load when the immediate
// live refresh replaced an old score with the current market.
const STORAGE_MAX_AGE = 5 * 60_000;

function readStored(): MarketClientPayload | null {
  try {
    for (const key of [STORAGE_KEY, "lynerva-market-snapshot-v5", "lynerva-market-snapshot-v4"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as MarketClientPayload & {
        storedAt?: number;
      };
      if (
        parsed.storedAt &&
        Date.now() - parsed.storedAt <= STORAGE_MAX_AGE &&
        Array.isArray(parsed.opportunities)
      ) {
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function marketIdentity(market: MarketOpportunity) {
  return [
    market.platform,
    market.platformMarketId,
    market.platformOutcomeId ?? "yes",
    market.recommendedSide ?? "none",
  ].join(":");
}

function movementBetween(
  previous: MarketOpportunity,
  current: MarketOpportunity,
): ScoreMovement | null {
  if (
    previous.lynervaScore === null ||
    current.lynervaScore === null ||
    previous.lynervaScore === current.lynervaScore
  ) {
    return null;
  }

  const delta = current.lynervaScore - previous.lynervaScore;
  const priceDeltaBps =
    previous.executablePriceBps === null || current.executablePriceBps === null
      ? null
      : current.executablePriceBps - previous.executablePriceBps;
  const probabilityDeltaBps =
    previous.recommendedProbabilityBps === null ||
    current.recommendedProbabilityBps === null
      ? null
      : current.recommendedProbabilityBps -
        previous.recommendedProbabilityBps;
  const reliabilityDeltaBps =
    current.model.reliabilityBps - previous.model.reliabilityBps;
  const marketQualityDelta =
    previous.scoreBreakdown && current.scoreBreakdown
      ? current.scoreBreakdown.marketQuality -
        previous.scoreBreakdown.marketQuality
      : null;
  const projectionSourceCountDelta =
    (current.model.components?.projectionSourceCount ?? 0) -
    (previous.model.components?.projectionSourceCount ?? 0);
  const previousConsensus =
    previous.model.components?.consensusProjection ?? null;
  const currentConsensus = current.model.components?.consensusProjection ?? null;
  const consensusProjectionDelta =
    previousConsensus === null || currentConsensus === null
      ? null
      : currentConsensus - previousConsensus;

  let reason: ScoreMovement["reason"] = "mixed";
  let detail = "Several scoring inputs changed on the latest refresh.";

  if (projectionSourceCountDelta !== 0) {
    reason = "projection_sources";
    detail =
      projectionSourceCountDelta > 0
        ? `Projection coverage increased by ${projectionSourceCountDelta} source${projectionSourceCountDelta === 1 ? "" : "s"}.`
        : `Projection coverage decreased by ${Math.abs(projectionSourceCountDelta)} source${Math.abs(projectionSourceCountDelta) === 1 ? "" : "s"}.`;
  } else if (
    probabilityDeltaBps !== null &&
    Math.abs(probabilityDeltaBps) >= 75
  ) {
    reason = "model_probability";
    detail = `Lynerva probability moved ${probabilityDeltaBps > 0 ? "+" : ""}${(
      probabilityDeltaBps / 100
    ).toFixed(1)} percentage points.`;
  } else if (priceDeltaBps !== null && Math.abs(priceDeltaBps) >= 50) {
    reason = "market_price";
    detail = `Executable market price moved ${priceDeltaBps > 0 ? "+" : ""}${(
      priceDeltaBps / 100
    ).toFixed(1)} percentage points.`;
  } else if (
    marketQualityDelta !== null &&
    Math.abs(marketQualityDelta) >= 2
  ) {
    reason = "market_quality";
    detail =
      "Bid-ask spread, liquidity, or quote freshness changed on the latest refresh.";
  }

  return {
    delta,
    previousScore: previous.lynervaScore,
    currentScore: current.lynervaScore,
    priceDeltaBps,
    probabilityDeltaBps,
    reliabilityDeltaBps,
    marketQualityDelta,
    projectionSourceCountDelta,
    consensusProjectionDelta,
    reason,
    detail,
  };
}

function stabilizePublishedScore(
  previous: MarketOpportunity,
  current: MarketOpportunity,
): MarketOpportunity {
  if (
    previous.lynervaScore === null ||
    current.lynervaScore === null ||
    previous.recommendedSide !== current.recommendedSide
  ) {
    return current;
  }

  const priceDelta =
    previous.executablePriceBps === null || current.executablePriceBps === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(
          current.executablePriceBps - previous.executablePriceBps,
        );
  const probabilityDelta =
    previous.recommendedProbabilityBps === null ||
    current.recommendedProbabilityBps === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(
          current.recommendedProbabilityBps -
            previous.recommendedProbabilityBps,
        );

  // The public score should not flap because a one-cent quote tick happened
  // between two 60-second refreshes. Pregame requires a 2pp price/model move
  // before publishing a new score. Live markets stay more responsive.
  const thresholdBps = current.isLive ? 100 : 200;
  const materialChange =
    priceDelta >= thresholdBps || probabilityDelta >= thresholdBps;

  if (materialChange || previous.lynervaScore === current.lynervaScore) {
    return current;
  }

  return {
    ...current,
    lynervaScore: previous.lynervaScore,
    scoreBreakdown: previous.scoreBreakdown,
  };
}

function annotateMovements(
  previous: MarketClientPayload,
  next: MarketClientPayload,
): MarketClientPayload {
  const previousByKey = new Map(
    previous.opportunities.map((market) => [marketIdentity(market), market]),
  );

  return {
    ...next,
    opportunities: next.opportunities.map((market) => {
      const earlier = previousByKey.get(marketIdentity(market));
      const stabilized = earlier
        ? stabilizePublishedScore(earlier, market)
        : market;
      const priceChanged =
        !earlier ||
        earlier.recommendedSide !== stabilized.recommendedSide ||
        earlier.executablePriceBps !== stabilized.executablePriceBps;
      return {
        ...stabilized,
        priceChangedAt: priceChanged
          ? earlier
            ? next.fetchedAt
            : stabilized.updatedAt
          : earlier.priceChangedAt ?? earlier.updatedAt,
        scoreMovement: earlier
          ? movementBetween(earlier, stabilized)
          : null,
      };
    }),
  };
}

function writeStored(payload: MarketClientPayload) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...payload, storedAt: Date.now() }),
    );
  } catch {
    // Storage is only an acceleration layer.
  }
}

export function MarketDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<MarketClientPayload>({
    opportunities: [],
    providers: [],
    ratedCount: 0,
    displayedCount: 0,
    fetchedAt: "",
  });
  const latestDataRef = useRef<MarketClientPayload>({
    opportunities: [],
    providers: [],
    ratedCount: 0,
    displayedCount: 0,
    fetchedAt: "",
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const lastSuccessfulRefreshAt = useRef(0);

  const refresh = async () => {
    if (inflight.current) return inflight.current;

    const request = (async () => {
      setRefreshing(true);
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);
        let response: Response;
        try {
          response = await fetch("/api/markets", {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
        if (!response.ok) {
          throw new Error(`Market feed returned ${response.status}`);
        }
        const payload = (await response.json()) as MarketClientPayload;
        const annotated = annotateMovements(latestDataRef.current, payload);
        latestDataRef.current = annotated;
        setData(annotated);
        writeStored(annotated);
        lastSuccessfulRefreshAt.current = Date.now();
        setError(null);
      } catch (caught) {
        setData((current) => {
          if (current.opportunities.length > 0) return current;
          const stored = readStored();
          if (stored) latestDataRef.current = stored;
          return stored ?? current;
        });
        setError(
          caught instanceof DOMException && caught.name === "AbortError"
            ? "Live refresh delayed. Showing the last verified snapshot while Lynerva retries."
            : caught instanceof Error
              ? caught.message
              : "Market feed unavailable",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();

    inflight.current = request;
    await request.finally(() => {
      inflight.current = null;
    });
  };

  useEffect(() => {
    const intervalMs = pathname === "/live" ? 10_000 : 60_000;
    const elapsed = Date.now() - lastSuccessfulRefreshAt.current;

    // Do not paint a localStorage snapshot and then replace it a few seconds
    // later. That created apparent score jumps even when the user had not
    // waited for a scheduled refresh. Stored data is now fallback-only.
    if (lastSuccessfulRefreshAt.current === 0 || elapsed >= intervalMs) {
      void refresh();
    } else {
      setLoading(false);
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastSuccessfulRefreshAt.current >= intervalMs
      ) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  const value = useMemo(
    () => ({
      ...data,
      loading,
      refreshing,
      error,
      refresh,
    }),
    [data, error, loading, refreshing],
  );

  return (
    <MarketDataContext.Provider value={value}>
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketData() {
  const value = useContext(MarketDataContext);
  if (!value) {
    throw new Error("useMarketData must be used inside MarketDataProvider");
  }
  return value;
}
