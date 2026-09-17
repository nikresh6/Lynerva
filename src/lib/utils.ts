import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatCents(bps: number | null) {
  if (bps === null) return "—";
  return `${Math.round(bps / 100)}¢`;
}

export function formatPercent(bps: number | null, digits = 0) {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(digits)}%`;
}

export function formatEdge(bps: number | null) {
  if (bps === null) return "—";
  const pp = bps / 100;
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`;
}

export function formatMoney(cents: number | null) {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatCompactMoney(cents: number | null) {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function relativeTime(iso: string, now = Date.now()) {
  const diffSeconds = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 1_000),
  );
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
