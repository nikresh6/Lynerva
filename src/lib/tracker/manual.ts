export type ManualTrackerStatus =
  | "open"
  | "win"
  | "loss"
  | "push"
  | "cashed";

export interface ManualTrackerBet {
  id: string;
  date: string;
  description: string;
  platform: "kalshi";
  stake: number;
  payout: number;
  /**
   * The exact realized profit/loss entered by the user. This intentionally
   * lives beside (rather than overwriting) the calculated payout so a manual
   * correction can always be audited or reset.
   */
  manualProfitOverride: number | null;
  status: ManualTrackerStatus;
  marketId: string | null;
  side: "yes" | "no" | null;
  entryPriceBps: number | null;
  entryModelProbabilityBps: number | null;
  isLive: boolean;
  isParlay: boolean;
  legs: string[];
  legMarketIds: string[];
  legSides: Array<"yes" | "no" | null>;
  legEntryPriceBps: Array<number | null>;
  legEntryModelProbabilityBps: Array<number | null>;
  toWin: number | null;
  decimalOdds: number | null;
}

export const MANUAL_TRACKER_NOTES_PREFIX = "lynerva-manual-v3:";

const STATUSES = new Set<ManualTrackerStatus>([
  "open",
  "win",
  "loss",
  "push",
  "cashed",
]);

function finiteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nullableBps(value: unknown) {
  const numeric = nullableNumber(value);
  if (numeric === null) return null;
  return Math.round(Math.min(10_000, Math.max(0, numeric)));
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sideArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (item === "yes" || item === "no" ? item : null));
}

function bpsArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(nullableBps);
}

export function normalizeManualTrackerBet(
  value: unknown,
): ManualTrackerBet | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  if (!id) return null;

  const stake = Math.max(0, finiteNumber(raw.stake));
  const payout = Math.max(0, finiteNumber(raw.payout));
  const decimalOdds = nullableNumber(raw.decimalOdds);
  const explicitToWin = nullableNumber(raw.toWin);
  const toWin =
    explicitToWin !== null && explicitToWin >= 0
      ? explicitToWin
      : decimalOdds !== null && decimalOdds > 1 && stake > 0
        ? stake * (decimalOdds - 1)
        : null;

  const rawStatus =
    typeof raw.status === "string" ? raw.status as ManualTrackerStatus : "open";
  const status = STATUSES.has(rawStatus) ? rawStatus : "open";

  const date =
    typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : new Date().toISOString().slice(0, 10);

  return {
    id,
    date,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description
        : "Tracked bet",
    platform: "kalshi",
    stake,
    payout,
    manualProfitOverride: nullableNumber(raw.manualProfitOverride),
    status,
    marketId: typeof raw.marketId === "string" && raw.marketId ? raw.marketId : null,
    side: raw.side === "yes" || raw.side === "no" ? raw.side : null,
    entryPriceBps: nullableBps(raw.entryPriceBps),
    entryModelProbabilityBps: nullableBps(raw.entryModelProbabilityBps),
    isLive: Boolean(raw.isLive),
    isParlay: Boolean(raw.isParlay),
    legs: stringArray(raw.legs),
    legMarketIds: stringArray(raw.legMarketIds),
    legSides: sideArray(raw.legSides),
    legEntryPriceBps: bpsArray(raw.legEntryPriceBps),
    legEntryModelProbabilityBps: bpsArray(raw.legEntryModelProbabilityBps),
    toWin,
    decimalOdds:
      decimalOdds !== null && decimalOdds > 1
        ? decimalOdds
        : toWin !== null && stake > 0
          ? 1 + toWin / stake
          : null,
  };
}

export function calculatedManualTrackerProfit(bet: ManualTrackerBet) {
  if (bet.status === "open") return null;
  if (bet.status === "loss") return -bet.stake;
  if (bet.status === "push") return 0;
  return bet.payout - bet.stake;
}

export function manualTrackerProfit(bet: ManualTrackerBet) {
  if (bet.status === "open") return null;
  return bet.manualProfitOverride ?? calculatedManualTrackerProfit(bet);
}
