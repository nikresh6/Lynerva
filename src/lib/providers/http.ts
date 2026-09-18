import "server-only";

import { z } from "zod";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchValidated<T extends z.ZodType>(
  provider: string,
  url: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const cacheOptions = init?.cache
    ? { cache: init.cache }
    : { next: { revalidate: 15 } };
  const response = await fetch(url, {
    ...init,
    ...cacheOptions,
    headers: {
      Accept: "application/json",
      "User-Agent": "Lynerva/1.0 market-research",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new ProviderError(
      provider,
      `${provider} returned ${response.status}`,
      response.status,
    );
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error(`${provider} response validation failed`, parsed.error.flatten());
    throw new ProviderError(provider, `${provider} response shape changed`);
  }
  return parsed.data;
}

export function dollarsToBps(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 10_000);
}

export function dollarsToCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

export function safeIso(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
