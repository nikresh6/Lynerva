type DatedKalshiMarket = {
  platformMarketId: string;
  eventTitle: string;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

// Kalshi's NFL tickers encode the scheduled game date, e.g.
// KXNFLPASSYDS-26OCT12BUFLAR-BUFJALLEN17-250.
// Exchange close times can be days after kickoff, so they cannot be used to
// tell whether the cached slate has already rolled over.
function gameDateUtc(market: DatedKalshiMarket): number | null {
  const value = `${market.eventTitle} ${market.platformMarketId}`.toUpperCase();
  const match = value.match(
    /(?:^|[-_])(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(?=[A-Z_-]|$)/,
  );
  if (!match) return null;

  const month = MONTHS.indexOf(match[2] as (typeof MONTHS)[number]);
  const date = Date.UTC(2000 + Number(match[1]), month, Number(match[3]));
  return Number.isFinite(date) ? date : null;
}

export function countRelevantCachedKalshiMarkets(
  markets: DatedKalshiMarket[],
  now = Date.now(),
) {
  // Keep games through the late night after their nominal date. Thirty hours
  // from midnight UTC covers Sunday/Monday night football, including overtime.
  const relevantUntilHoursAfterGameDate = 30;
  const graceMs = relevantUntilHoursAfterGameDate * 60 * 60 * 1_000;

  return markets.filter((market) => {
    const day = gameDateUtc(market);
    // For unknown tickers, err toward protecting the last good snapshot.
    return day === null || day + graceMs >= now;
  }).length;
}

export function shouldPreserveKalshiSnapshot(
  previous: DatedKalshiMarket[],
  incoming: DatedKalshiMarket[],
  now = Date.now(),
) {
  const relevantPreviousCount = countRelevantCachedKalshiMarkets(previous, now);
  // Once the prior slate has expired it cannot be a reliable floor for the
  // new one. Comparing against *all* previous markets kept a 3,382-contract
  // Sunday snapshot ahead of 859 valid Monday contracts, producing no picks.
  return (
    relevantPreviousCount > 0 &&
    incoming.length < relevantPreviousCount * 0.5
  );
}
