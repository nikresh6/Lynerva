/** Exact public listing and trade-side identity shared by Picks and Results. */
export function resultsPickKey(input: {
  platform: string;
  platformMarketId: string;
  platformOutcomeId: string | null | undefined;
  side: "yes" | "no" | null | undefined;
}) {
  return JSON.stringify([
    input.platform,
    input.platformMarketId,
    input.platformOutcomeId ?? "yes",
    input.side ?? "none",
  ]);
}
