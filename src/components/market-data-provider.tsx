"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MarketOpportunity, Platform } from "@/lib/markets/types";

export interface ProviderSummary {
  provider: Platform;
  count: number;
  fetchedAt: string;
  error: string | null;
}

interface MarketClientPayload {
  opportunities: MarketOpportunity[];
  providers: ProviderSummary[];
  fetchedAt: string;
}

interface MarketDataContextValue extends MarketClientPayload {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

const STORAGE_KEY = "lynerva-market-snapshot-v1";
const STORAGE_MAX_AGE = 5 * 60 * 1_000;

function readStored(): MarketClientPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketClientPayload & {
      storedAt?: number;
    };
    if (
      !parsed.storedAt ||
      Date.now() - parsed.storedAt > STORAGE_MAX_AGE ||
      !Array.isArray(parsed.opportunities)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(payload: MarketClientPayload) {
  try {
    sessionStorage.setItem(
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
  const [data, setData] = useState<MarketClientPayload>({
    opportunities: [],
    providers: [],
    fetchedAt: "",
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = async () => {
    if (inflight.current) return inflight.current;

    const request = (async () => {
      setRefreshing(true);
      try {
        const response = await fetch("/api/markets", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`Market feed returned ${response.status}`);
        }
        const payload = (await response.json()) as MarketClientPayload;
        setData(payload);
        writeStored(payload);
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Market feed unavailable",
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
    const stored = readStored();
    if (stored) {
      setData(stored);
      setLoading(false);
    }
    void refresh();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
